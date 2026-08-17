-- Feature 14: persistent, realtime in-app notifications.
--
-- Task/submission triggers write the durable row in the same transaction as
-- the business action. A second trigger broadcasts that committed intent to a
-- private, per-user Realtime channel.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  kind text not null check (
    kind in (
      'task_assigned',
      'task_reassigned',
      'work_submitted',
      'work_approved',
      'revision_requested'
    )
  ),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 500),
  href text not null check (
    href in ('/dashboard/my-tasks', '/dashboard/tasks')
  ),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Both list and unread-count queries start with the signed-in recipient.
create index notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);

create index notifications_recipient_unread_idx
  on public.notifications (recipient_id, created_at desc)
  where read_at is null;

-- PostgreSQL does not create indexes automatically for non-primary-key FKs.
create index notifications_actor_idx
  on public.notifications (actor_id)
  where actor_id is not null;

create index notifications_task_idx
  on public.notifications (task_id)
  where task_id is not null;

alter table public.notifications enable row level security;

create policy "notifications_select_own"
on public.notifications
for select
to authenticated
using (
  recipient_id = (select auth.uid())
  and (select public.is_active())
);

create policy "notifications_update_own"
on public.notifications
for update
to authenticated
using (
  recipient_id = (select auth.uid())
  and (select public.is_active())
)
with check (
  recipient_id = (select auth.uid())
  and (select public.is_active())
);

-- Data API grants are separate from RLS. Browser clients can only read rows
-- and change read_at; they cannot forge or delete notification evidence.
revoke all on table public.notifications from anon, authenticated;
grant select on table public.notifications to authenticated;
grant update (read_at) on table public.notifications to authenticated;

create function private.create_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_task_id uuid,
  p_kind text,
  p_title text,
  p_message text,
  p_href text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Self-actions add noise, and an inactive/unaccepted account must not gain a
  -- new user-facing record while it cannot use the application.
  if p_recipient_id is null
     or p_recipient_id is not distinct from p_actor_id then
    return;
  end if;

  insert into public.notifications (
    recipient_id,
    actor_id,
    task_id,
    kind,
    title,
    message,
    href
  )
  select
    p.id,
    p_actor_id,
    p_task_id,
    p_kind,
    p_title,
    p_message,
    p_href
  from public.profiles p
  where p.id = p_recipient_id
    and p.accepted_at is not null
    and p.deleted_at is null;
end;
$$;

create function private.notify_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor uuid := (select auth.uid());
  actor_name text;
begin
  select p.full_name
    into actor_name
  from public.profiles p
  where p.id = current_actor;

  actor_name := coalesce(actor_name, 'Meritly');

  if tg_op = 'INSERT' then
    perform private.create_notification(
      new.assigned_to,
      current_actor,
      new.id,
      'task_assigned',
      'New task assigned',
      format('%s assigned you “%s”.', actor_name, new.title),
      '/dashboard/my-tasks'
    );
    return new;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    perform private.create_notification(
      new.assigned_to,
      current_actor,
      new.id,
      'task_reassigned',
      'Task reassigned to you',
      format('%s reassigned “%s” to you.', actor_name, new.title),
      '/dashboard/my-tasks'
    );
  end if;

  if new.status is distinct from old.status and new.status = 'completed' then
    perform private.create_notification(
      new.assigned_to,
      current_actor,
      new.id,
      'work_approved',
      'Work approved',
      format('%s approved your work for “%s”.', actor_name, new.title),
      '/dashboard/my-tasks'
    );
  elsif new.status is distinct from old.status
        and new.status = 'needs_revision' then
    perform private.create_notification(
      new.assigned_to,
      current_actor,
      new.id,
      'revision_requested',
      'Revision requested',
      format('%s requested changes for “%s”.', actor_name, new.title),
      '/dashboard/my-tasks'
    );
  end if;

  return new;
end;
$$;

create function private.notify_submission_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  task_row record;
  current_actor uuid := (select auth.uid());
  actor_name text;
begin
  select t.assigned_by, t.title
    into task_row
  from public.tasks t
  where t.id = new.task_id;

  select p.full_name
    into actor_name
  from public.profiles p
  where p.id = current_actor;

  -- Test the task result itself. PL/pgSQL's FOUND value was changed by the
  -- actor-name query above, so using FOUND here would check the wrong SELECT.
  if task_row.assigned_by is not null then
    perform private.create_notification(
      task_row.assigned_by,
      current_actor,
      new.task_id,
      'work_submitted',
      'Work submitted',
      format(
        '%s submitted work for “%s”.',
        coalesce(actor_name, 'An employee'),
        task_row.title
      ),
      '/dashboard/tasks'
    );
  end if;

  return new;
end;
$$;

create trigger notify_task_change
after insert or update of assigned_to, status
on public.tasks
for each row
execute function private.notify_task_change();

create trigger notify_submission_created
after insert
on public.submissions
for each row
execute function private.notify_submission_created();

-- Broadcast only the recipient's own insert topic. The durable notification
-- remains the source of truth; clients refetch it after receiving this signal.
create function private.broadcast_notification_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'notifications:' || new.recipient_id::text,
    'INSERT',
    'INSERT',
    tg_table_name,
    tg_table_schema,
    new,
    null
  );
  return new;
end;
$$;

create trigger broadcast_notification_insert
after insert
on public.notifications
for each row
execute function private.broadcast_notification_insert();

-- A private topic is readable only when its UUID is the current active user.
-- No INSERT policy is created, so browser clients cannot broadcast messages.
create policy "notification_recipient_can_receive_broadcast"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and (select public.is_active())
  and (select realtime.topic()) =
    'notifications:' || (select auth.uid())::text
);

-- These functions are trigger-only implementation details, not public RPCs.
revoke execute on function private.create_notification(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
revoke execute on function private.notify_task_change()
  from public, anon, authenticated, service_role;
revoke execute on function private.notify_submission_created()
  from public, anon, authenticated, service_role;
revoke execute on function private.broadcast_notification_insert()
  from public, anon, authenticated, service_role;
