-- Feature 12: production-grade offboarding and work custody.
--
-- Access revocation and work transfer are deliberately separate:
-- deactivation never requires a replacement, while an optional transfer
-- requires task permissions and commits in the same transaction.

create table public.user_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique not null,
  target_user_id uuid not null references public.profiles(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  actor_kind text not null check (actor_kind in ('authenticated', 'system')),
  action text not null check (action in ('archive', 'restore', 'role_change')),
  previous_role_id integer references public.roles(id) on delete restrict,
  new_role_id integer references public.roles(id) on delete restrict,
  replacement_user_id uuid references public.profiles(id) on delete restrict,
  reason text not null check (char_length(reason) between 3 and 500),
  reassigned_task_count integer not null default 0
    check (reassigned_task_count >= 0),
  queued_task_count integer not null default 0
    check (queued_task_count >= 0),
  submitted_task_count integer not null default 0
    check (submitted_task_count >= 0),
  created_at timestamptz not null default now(),
  constraint lifecycle_actor_check check (
    (actor_kind = 'authenticated' and actor_id is not null)
    or (actor_kind = 'system' and actor_id is null)
  )
);

create index user_lifecycle_events_target_created_idx
  on public.user_lifecycle_events (target_user_id, created_at desc);
create index user_lifecycle_events_actor_created_idx
  on public.user_lifecycle_events (actor_id, created_at desc)
  where actor_id is not null;

create table public.task_assignment_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  from_user_id uuid references public.profiles(id) on delete restrict,
  to_user_id uuid not null references public.profiles(id) on delete restrict,
  changed_by uuid references public.profiles(id) on delete restrict,
  request_id uuid,
  reason text check (reason is null or char_length(reason) between 3 and 500),
  created_at timestamptz not null default now()
);

create index task_assignment_history_task_created_idx
  on public.task_assignment_history (task_id, created_at desc);
create index task_assignment_history_from_user_idx
  on public.task_assignment_history (from_user_id)
  where from_user_id is not null;
create index task_assignment_history_to_user_idx
  on public.task_assignment_history (to_user_id);
create index task_assignment_history_request_idx
  on public.task_assignment_history (request_id)
  where request_id is not null;

-- The queue and transfer both filter by assignee and active task status.
create index tasks_active_assignee_status_idx
  on public.tasks (assigned_to, status, id)
  where deleted_at is null and status <> 'completed';

alter table public.user_lifecycle_events enable row level security;
alter table public.task_assignment_history enable row level security;

revoke all on table public.user_lifecycle_events
  from anon, authenticated, public;
revoke all on table public.task_assignment_history
  from anon, authenticated, public;
grant select on table public.user_lifecycle_events to authenticated;
grant select on table public.task_assignment_history to authenticated;

create policy "user_lifecycle_events_select"
on public.user_lifecycle_events
for select
to authenticated
using (
  (select public.is_active())
  and (
    (select public.has_permission('user.manage_all'))
    or (select public.has_permission('user.promote'))
    or (select public.has_permission('user.archive'))
  )
);

create policy "task_assignment_history_select"
on public.task_assignment_history
for select
to authenticated
using (
  (select public.is_active())
  and (
    from_user_id = (select auth.uid())
    or to_user_id = (select auth.uid())
    or (select public.has_permission('task.view_all'))
    or (select public.has_permission('stats.view_all'))
  )
);

-- Even privileged/direct writes cannot rewrite append-only history accidentally.
create function public.reject_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'audit history is append-only';
end;
$$;

create trigger protect_user_lifecycle_events
before update or delete on public.user_lifecycle_events
for each row execute function public.reject_audit_mutation();

create trigger protect_task_assignment_history
before update or delete on public.task_assignment_history
for each row execute function public.reject_audit_mutation();

revoke execute on function public.reject_audit_mutation()
  from anon, authenticated, public;

-- Locks and validates every new assignee, including service/direct SQL writes.
-- FOR SHARE conflicts with a profile archive/role update, closing the race where
-- a task is assigned while that worker is being deactivated.
create function public.validate_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'submitted' then
    raise exception 'submitted tasks must remain with the original employee';
  end if;

  perform p.id
  from public.profiles p
  where p.id = new.assigned_to
  for share;

  if not found or not exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = new.assigned_to
      and p.deleted_at is null
      and p.accepted_at is not null
      and r.assignable_work
  ) then
    raise exception 'assignee must be an active worker who accepted their invite';
  end if;

  return new;
end;
$$;

create trigger validate_task_assignee
before insert or update of assigned_to on public.tasks
for each row execute function public.validate_task_assignee();

revoke execute on function public.validate_task_assignee()
  from anon, authenticated, public;

-- Record every ownership change, whether it came from offboarding or the normal
-- Tasks screen. Caller identity is always taken from auth.uid().
create function public.audit_task_assignment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_request_id uuid;
  context_reason text;
begin
  if new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;

  context_request_id :=
    nullif(current_setting('meritly.lifecycle_request_id', true), '')::uuid;
  context_reason :=
    nullif(current_setting('meritly.lifecycle_reason', true), '');

  insert into public.task_assignment_history (
    task_id,
    from_user_id,
    to_user_id,
    changed_by,
    request_id,
    reason
  ) values (
    new.id,
    old.assigned_to,
    new.assigned_to,
    auth.uid(),
    context_request_id,
    coalesce(context_reason, 'Direct task reassignment')
  );

  return new;
end;
$$;

create trigger audit_task_assignment_change
after update of assigned_to on public.tasks
for each row execute function public.audit_task_assignment_change();

revoke execute on function public.audit_task_assignment_change()
  from anon, authenticated, public;

-- Profile lifecycle changes are audited independently of the UI. Counts are
-- calculated here as a trusted definer operation, so archiving without task
-- permissions still records the real custody state.
create function public.audit_profile_lifecycle_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_request_id uuid;
  context_reason text;
  context_replacement_id uuid;
  event_action text;
  actor uuid := auth.uid();
  reassigned_count integer := 0;
  queued_count integer := 0;
  submitted_count integer := 0;
begin
  if new.role_id is not distinct from old.role_id
     and new.deleted_at is not distinct from old.deleted_at then
    return new;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    event_action := 'archive';
  elsif old.deleted_at is not null and new.deleted_at is null then
    event_action := 'restore';
  else
    event_action := 'role_change';
  end if;

  context_request_id :=
    coalesce(
      nullif(current_setting('meritly.lifecycle_request_id', true), '')::uuid,
      gen_random_uuid()
    );
  context_reason :=
    coalesce(
      nullif(current_setting('meritly.lifecycle_reason', true), ''),
      'Direct user-management action'
    );
  context_replacement_id :=
    nullif(current_setting('meritly.lifecycle_replacement_id', true), '')::uuid;

  select count(*)::integer
  into reassigned_count
  from public.task_assignment_history h
  where h.request_id = context_request_id;

  select
    count(*) filter (
      where t.status in ('pending', 'in_progress', 'needs_revision', 'overdue')
    )::integer,
    count(*) filter (where t.status = 'submitted')::integer
  into queued_count, submitted_count
  from public.tasks t
  where t.assigned_to = new.id
    and t.deleted_at is null
    and t.status <> 'completed';

  insert into public.user_lifecycle_events (
    request_id,
    target_user_id,
    actor_id,
    actor_kind,
    action,
    previous_role_id,
    new_role_id,
    replacement_user_id,
    reason,
    reassigned_task_count,
    queued_task_count,
    submitted_task_count
  ) values (
    context_request_id,
    new.id,
    actor,
    case when actor is null then 'system' else 'authenticated' end,
    event_action,
    old.role_id,
    new.role_id,
    context_replacement_id,
    context_reason,
    reassigned_count,
    queued_count,
    submitted_count
  );

  return new;
end;
$$;

create trigger audit_profile_lifecycle_change
after update of role_id, deleted_at on public.profiles
for each row execute function public.audit_profile_lifecycle_change();

revoke execute on function public.audit_profile_lifecycle_change()
  from anon, authenticated, public;

-- One browser call performs an optional transfer and the profile lifecycle
-- change. SECURITY INVOKER intentionally keeps existing RLS and Feature 11
-- protected-column triggers in force.
create function public.offboard_user(
  p_request_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_target_role_id integer default null,
  p_replacement_user_id uuid default null,
  p_reason text default null
)
returns table (
  reassigned_task_count integer,
  queued_task_count integer,
  submitted_task_count integer,
  duplicate_request boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  clean_reason text := btrim(coalesce(p_reason, ''));
  caller_id uuid := auth.uid();
  target_role integer;
  target_deleted_at timestamptz;
  target_assignable boolean;
  requested_role_assignable boolean;
  existing_event public.user_lifecycle_events%rowtype;
begin
  if caller_id is null or not public.is_active() then
    raise exception 'authentication required';
  end if;

  if p_request_id is null then
    raise exception 'request id is required';
  end if;

  if p_action not in ('archive', 'role_change') then
    raise exception 'action must be archive or role_change';
  end if;

  if char_length(clean_reason) not between 3 and 500 then
    raise exception 'reason must be between 3 and 500 characters';
  end if;

  if p_target_user_id = caller_id then
    raise exception 'you cannot offboard yourself';
  end if;

  if p_action = 'archive'
     and not (
       public.has_permission('user.archive')
       or public.has_permission('user.manage_all')
     ) then
    raise exception 'not allowed to archive this user';
  end if;

  if p_action = 'role_change'
     and not (
       public.has_permission('user.promote')
       or public.has_permission('user.manage_all')
     ) then
    raise exception 'not allowed to change this user''s role';
  end if;

  select e.*
  into existing_event
  from public.user_lifecycle_events e
  where e.request_id = p_request_id
    and e.actor_id = caller_id;

  if found then
    return query
      select
        existing_event.reassigned_task_count,
        existing_event.queued_task_count,
        existing_event.submitted_task_count,
        true;
    return;
  end if;

  if p_replacement_user_id is not null then
    if p_replacement_user_id = p_target_user_id then
      raise exception 'replacement must be a different user';
    end if;
    if not (
      public.has_permission('task.view_all')
      and public.has_permission('task.update')
    ) then
      raise exception 'task.view_all and task.update are required to transfer work';
    end if;

    -- Ordinary task updates lock task rows before the assignee profile; use the
    -- same order to reduce lock inversion under concurrent reassignment.
    perform t.id
    from public.tasks t
    where t.assigned_to = p_target_user_id
      and t.deleted_at is null
      and t.status <> 'completed'
    order by t.id
    for update;
  end if;

  -- UUID ordering gives concurrent lifecycle operations one stable profile
  -- lock order.
  perform p.id
  from public.profiles p
  where p.id in (p_target_user_id, p_replacement_user_id)
  order by p.id
  for update;

  select p.role_id, p.deleted_at, r.assignable_work
  into target_role, target_deleted_at, target_assignable
  from public.profiles p
  join public.roles r on r.id = p.role_id
  where p.id = p_target_user_id;

  if not found then
    raise exception 'target user not found';
  end if;

  if p_action = 'archive' and target_deleted_at is not null then
    raise exception 'target user is already archived';
  end if;

  if p_action = 'role_change' then
    if p_target_role_id is null then
      raise exception 'target role is required';
    end if;

    select r.assignable_work
    into requested_role_assignable
    from public.roles r
    where r.id = p_target_role_id;

    if not found then
      raise exception 'target role not found';
    end if;
    if p_target_role_id = target_role then
      raise exception 'target already has this role';
    end if;
    if not target_assignable or requested_role_assignable then
      raise exception 'offboarding role changes must move a worker to a non-worker role';
    end if;
  end if;

  if p_replacement_user_id is not null then
    if not target_assignable then
      raise exception 'only a worker''s tasks can be transferred';
    end if;
    if not public.is_assignable_employee(p_replacement_user_id) then
      raise exception 'replacement must be active, accepted, and assignable';
    end if;

    -- Capture any assignment that committed before the target profile lock.
    perform t.id
    from public.tasks t
    where t.assigned_to = p_target_user_id
      and t.deleted_at is null
      and t.status <> 'completed'
    order by t.id
    for update;
  end if;

  perform set_config(
    'meritly.lifecycle_request_id',
    p_request_id::text,
    true
  );
  perform set_config('meritly.lifecycle_reason', clean_reason, true);
  perform set_config(
    'meritly.lifecycle_replacement_id',
    coalesce(p_replacement_user_id::text, ''),
    true
  );

  if p_replacement_user_id is not null then
    update public.tasks
    set assigned_to = p_replacement_user_id
    where assigned_to = p_target_user_id
      and deleted_at is null
      and status in ('pending', 'in_progress', 'needs_revision', 'overdue');
  end if;

  if p_action = 'archive' then
    update public.profiles
    set deleted_at = now()
    where id = p_target_user_id;
  else
    update public.profiles
    set role_id = p_target_role_id
    where id = p_target_user_id;
  end if;

  select e.*
  into existing_event
  from public.user_lifecycle_events e
  where e.request_id = p_request_id;

  if not found then
    raise exception 'lifecycle audit event was not created';
  end if;

  return query
    select
      existing_event.reassigned_task_count,
      existing_event.queued_task_count,
      existing_event.submitted_task_count,
      false;
end;
$$;

revoke execute on function public.offboard_user(
  uuid, uuid, text, integer, uuid, text
) from anon, public;
grant execute on function public.offboard_user(
  uuid, uuid, text, integer, uuid, text
) to authenticated;

-- A derived queue cannot become stale: it reflects the assignee's current
-- profile/role state every time it is read.
create function public.offboarding_queue()
returns table (
  task_id uuid,
  category text,
  assignee_state text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.has_permission('task.view_all') then
    raise exception 'task.view_all is required to view the custody queue';
  end if;

  return query
    select
      t.id,
      case
        when t.status = 'submitted' then 'needs_review'
        else 'needs_reassignment'
      end,
      case
        when p.deleted_at is not null then 'archived'
        when p.accepted_at is null then 'unaccepted'
        when not r.assignable_work then 'non_worker'
        else 'unknown'
      end
    from public.tasks t
    join public.profiles p on p.id = t.assigned_to
    join public.roles r on r.id = p.role_id
    where t.deleted_at is null
      and t.status <> 'completed'
      and (
        p.deleted_at is not null
        or p.accepted_at is null
        or not r.assignable_work
      )
    order by t.created_at desc;
end;
$$;

revoke execute on function public.offboarding_queue()
  from anon, public;
grant execute on function public.offboarding_queue()
  to authenticated;

-- Performance pickers need current workers plus anyone who has durable work
-- history. This definer function is read-only and checks stats.view_all before
-- reading auth.users for email addresses.
create function public.historical_employees()
returns table (
  id uuid,
  full_name text,
  role text,
  email text,
  deleted_at timestamptz,
  accepted boolean,
  current_assignable boolean,
  has_history boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('stats.view_all') then
    raise exception 'stats.view_all is required to list performance subjects';
  end if;

  return query
    with historical_ids as (
      select t.assigned_to as user_id from public.tasks t
      union
      select s.employee_id from public.submissions s
      union
      select a.employee_id from public.activity_log a
      union
      select h.from_user_id
      from public.task_assignment_history h
      where h.from_user_id is not null
      union
      select h.to_user_id from public.task_assignment_history h
      union
      select rt.employee_id from public.ratings rt
    ),
    subject_ids as (
      select p.id as user_id
      from public.profiles p
      join public.roles r on r.id = p.role_id
      where p.deleted_at is null
        and p.accepted_at is not null
        and r.assignable_work
      union
      select h.user_id from historical_ids h
    )
    select
      p.id,
      p.full_name,
      r.name,
      u.email::text,
      p.deleted_at,
      (p.accepted_at is not null),
      (
        p.deleted_at is null
        and p.accepted_at is not null
        and r.assignable_work
      ),
      exists (
        select 1 from historical_ids h where h.user_id = p.id
      )
    from subject_ids s
    join public.profiles p on p.id = s.user_id
    join public.roles r on r.id = p.role_id
    left join auth.users u on u.id = p.id
    where p.id <> auth.uid()
    order by p.created_at;
end;
$$;

revoke execute on function public.historical_employees()
  from anon, public;
grant execute on function public.historical_employees()
  to authenticated;

create function public.can_view_performance_subject(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when target = auth.uid() then public.is_active()
      when not public.has_permission('stats.view_all') then false
      else exists (
        select 1
        from public.profiles p
        join public.roles r on r.id = p.role_id
        where p.id = target
          and (
            (
              p.deleted_at is null
              and p.accepted_at is not null
              and r.assignable_work
            )
            or exists (
              select 1 from public.tasks t where t.assigned_to = target
            )
            or exists (
              select 1 from public.submissions s where s.employee_id = target
            )
            or exists (
              select 1 from public.activity_log a where a.employee_id = target
            )
            or exists (
              select 1
              from public.task_assignment_history h
              where h.from_user_id = target or h.to_user_id = target
            )
            or exists (
              select 1 from public.ratings rt where rt.employee_id = target
            )
          )
      )
    end;
$$;

revoke execute on function public.can_view_performance_subject(uuid)
  from anon, public;
grant execute on function public.can_view_performance_subject(uuid)
  to authenticated;
