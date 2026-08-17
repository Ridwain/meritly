-- Feature 14 follow-up: notification delivery must never make a valid task
-- operation fail because display text is long or Realtime is unavailable.

create or replace function private.create_notification(
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
    left(p_title, 120),
    left(p_message, 500),
    p_href
  from public.profiles p
  where p.id = p_recipient_id
    and p.accepted_at is not null
    and p.deleted_at is null;
end;
$$;

create or replace function private.broadcast_notification_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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
  exception when others then
    -- Realtime is an enhancement. The durable notification and the business
    -- transaction must still commit when the socket service is unavailable.
    raise warning 'Notification broadcast failed for %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke execute on function private.create_notification(
  uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated, service_role;
revoke execute on function private.broadcast_notification_insert()
  from public, anon, authenticated, service_role;
