-- Meritly MCP v1: connection, approval, idempotency, and audit foundation.
--
-- Private rows are reachable only through narrowly-scoped functions. Normal
-- application and MCP traffic still runs with the user's authenticated JWT;
-- no service-role credential is required by the MCP runtime.

-- ---------------------------------------------------------------------------
-- Private state
-- ---------------------------------------------------------------------------

create table private.mcp_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.profiles(id) on delete restrict,
  upstream_client_id text not null
    check (char_length(upstream_client_id) between 1 and 2048),
  downstream_client_hash text not null
    check (downstream_client_hash ~ '^[0-9a-f]{64}$'),
  client_name text not null
    check (char_length(btrim(client_name)) between 1 and 120),
  client_uri text
    check (client_uri is null or char_length(client_uri) <= 2048),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, upstream_client_id, downstream_client_hash)
);

create index mcp_connections_user_active_idx
  on private.mcp_connections (user_id, last_seen_at desc)
  where revoked_at is null;

create table private.mcp_approval_intents (
  id uuid primary key default gen_random_uuid(),
  approval_token uuid not null unique default gen_random_uuid(),
  connection_id uuid not null
    references private.mcp_connections(id) on delete restrict,
  actor_id uuid not null
    references public.profiles(id) on delete restrict,
  tool_name text not null
    check (tool_name in (
      'create_task',
      'update_task',
      'archive_task',
      'start_task',
      'submit_work',
      'review_submission'
    )),
  request_id uuid not null,
  target_id uuid,
  payload_hash text not null
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null
    check (jsonb_typeof(payload) = 'object'),
  state text not null default 'pending'
    check (state in ('pending', 'approved', 'denied', 'consumed')),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  approved_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (connection_id, tool_name, request_id)
);

create index mcp_approval_actor_pending_idx
  on private.mcp_approval_intents (actor_id, expires_at)
  where state in ('pending', 'approved');

create table private.operation_requests (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null
    references public.profiles(id) on delete restrict,
  connection_id uuid
    references private.mcp_connections(id) on delete restrict,
  channel text not null
    check (channel in ('web', 'mcp')),
  scope_key text not null
    check (char_length(scope_key) between 1 and 80),
  tool_name text not null
    check (tool_name in (
      'create_task',
      'update_task',
      'archive_task',
      'start_task',
      'submit_work',
      'review_submission'
    )),
  request_id uuid not null,
  target_id uuid,
  payload_hash text not null
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (actor_id, scope_key, request_id),
  check (
    (channel = 'web' and connection_id is null and scope_key = 'web')
    or
    (channel = 'mcp' and connection_id is not null)
  ),
  check (
    (result is null and completed_at is null)
    or
    (result is not null and completed_at is not null)
  )
);

create index operation_requests_expiry_idx
  on private.operation_requests (created_at);

create table private.operation_audit_log (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique
    references private.operation_requests(id) on delete restrict,
  actor_id uuid not null
    references public.profiles(id) on delete restrict,
  connection_id uuid
    references private.mcp_connections(id) on delete restrict,
  channel text not null
    check (channel in ('web', 'mcp')),
  tool_name text not null,
  request_id uuid not null,
  target_id uuid,
  payload_hash text not null
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index operation_audit_actor_created_idx
  on private.operation_audit_log (actor_id, created_at desc);
create index operation_audit_connection_created_idx
  on private.operation_audit_log (connection_id, created_at desc)
  where connection_id is not null;

alter table private.mcp_connections enable row level security;
alter table private.mcp_approval_intents enable row level security;
alter table private.operation_requests enable row level security;
alter table private.operation_audit_log enable row level security;

revoke all on table private.mcp_connections
  from public, anon, authenticated;
revoke all on table private.mcp_approval_intents
  from public, anon, authenticated;
revoke all on table private.operation_requests
  from public, anon, authenticated;
revoke all on table private.operation_audit_log
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create function private.mcp_payload_hash(p_payload jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );
$$;

create function private.require_active_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
begin
  if actor_id is null or not exists (
    select 1
    from public.profiles p
    where p.id = actor_id
      and p.deleted_at is null
      and p.accepted_at is not null
  ) then
    raise exception 'authentication required';
  end if;

  return actor_id;
end;
$$;

create function private.touch_mcp_connection(
  p_downstream_client_hash text,
  p_client_name text,
  p_client_uri text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := private.require_active_actor();
  oauth_client_id text := nullif(auth.jwt()->>'client_id', '');
  clean_name text := btrim(coalesce(p_client_name, ''));
  clean_uri text := nullif(btrim(coalesce(p_client_uri, '')), '');
  connection_id uuid;
begin
  if oauth_client_id is null then
    raise exception 'an OAuth client token is required';
  end if;
  if p_downstream_client_hash is null
     or p_downstream_client_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid MCP client identity';
  end if;
  if char_length(clean_name) not between 1 and 120 then
    raise exception 'client name must be between 1 and 120 characters';
  end if;
  if clean_uri is not null and char_length(clean_uri) > 2048 then
    raise exception 'client URI is too long';
  end if;

  insert into private.mcp_connections (
    user_id,
    upstream_client_id,
    downstream_client_hash,
    client_name,
    client_uri
  ) values (
    actor_id,
    oauth_client_id,
    p_downstream_client_hash,
    clean_name,
    clean_uri
  )
  on conflict (user_id, upstream_client_id, downstream_client_hash)
  do update set
    client_name = excluded.client_name,
    client_uri = excluded.client_uri,
    last_seen_at = now()
  where private.mcp_connections.revoked_at is null
  returning id into connection_id;

  if connection_id is null then
    raise exception 'this MCP connection has been revoked';
  end if;

  return connection_id;
end;
$$;

create function private.begin_operation(
  p_tool_name text,
  p_request_id uuid,
  p_payload jsonb,
  p_connection_hash text default null,
  p_approval_token uuid default null
)
returns table (
  operation_id uuid,
  actor_id uuid,
  connection_id uuid,
  channel text,
  payload_hash text,
  duplicate_request boolean,
  previous_result jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor uuid := private.require_active_actor();
  oauth_client_id text := nullif(auth.jwt()->>'client_id', '');
  current_connection uuid;
  current_channel text;
  current_scope text;
  current_hash text;
  inserted_id uuid;
  existing_request private.operation_requests%rowtype;
  consumed_intent uuid;
begin
  if p_tool_name not in (
    'create_task',
    'update_task',
    'archive_task',
    'start_task',
    'submit_work',
    'review_submission'
  ) then
    raise exception 'unsupported operation';
  end if;
  if p_request_id is null then
    raise exception 'request id is required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;
  if octet_length(p_payload::text) > 32768 then
    raise exception 'payload is too large';
  end if;

  current_hash := private.mcp_payload_hash(p_payload);

  if oauth_client_id is null then
    if p_connection_hash is not null or p_approval_token is not null then
      raise exception 'browser operations cannot provide MCP credentials';
    end if;
    current_channel := 'web';
    current_scope := 'web';
    perform set_config('meritly.mcp_connection_id', '', true);
    perform set_config('meritly.mcp_tool_name', '', true);
  else
    if p_connection_hash is null
       or p_connection_hash !~ '^[0-9a-f]{64}$'
       or p_approval_token is null then
      raise exception 'MCP approval is required';
    end if;

    select c.id
    into current_connection
    from private.mcp_connections c
    where c.user_id = current_actor
      and c.upstream_client_id = oauth_client_id
      and c.downstream_client_hash = p_connection_hash
      and c.revoked_at is null
    for update;

    if current_connection is null then
      raise exception 'MCP connection not found or revoked';
    end if;

    update private.mcp_connections
    set last_seen_at = now()
    where id = current_connection;

    current_channel := 'mcp';
    current_scope := current_connection::text;
    perform set_config(
      'meritly.mcp_connection_id',
      current_connection::text,
      true
    );
    perform set_config('meritly.mcp_tool_name', p_tool_name, true);
  end if;

  insert into private.operation_requests (
    actor_id,
    connection_id,
    channel,
    scope_key,
    tool_name,
    request_id,
    payload_hash
  ) values (
    current_actor,
    current_connection,
    current_channel,
    current_scope,
    p_tool_name,
    p_request_id,
    current_hash
  )
  on conflict on constraint operation_requests_actor_id_scope_key_request_id_key
  do nothing
  returning id into inserted_id;

  if inserted_id is null then
    select r.*
    into existing_request
    from private.operation_requests r
    where r.actor_id = current_actor
      and r.scope_key = current_scope
      and r.request_id = p_request_id
    for update;

    if existing_request.tool_name <> p_tool_name
       or existing_request.payload_hash <> current_hash then
      raise exception 'request id was already used with different input';
    end if;
    if existing_request.result is null then
      raise exception 'request is incomplete; retry later';
    end if;

    return query select
      existing_request.id,
      current_actor,
      existing_request.connection_id,
      existing_request.channel,
      existing_request.payload_hash,
      true,
      existing_request.result;
    return;
  end if;

  if current_channel = 'mcp' then
    update private.mcp_approval_intents a
    set
      state = 'consumed',
      consumed_at = now()
    where a.approval_token = p_approval_token
      and a.connection_id = current_connection
      and a.actor_id = current_actor
      and a.tool_name = p_tool_name
      and a.request_id = p_request_id
      and a.payload_hash = current_hash
      and a.state = 'approved'
      and a.expires_at > now()
    returning a.id into consumed_intent;

    if consumed_intent is null then
      raise exception 'approval is missing, expired, changed, or already used';
    end if;
  end if;

  return query select
    inserted_id,
    current_actor,
    current_connection,
    current_channel,
    current_hash,
    false,
    null::jsonb;
end;
$$;

create function private.complete_operation(
  p_operation_id uuid,
  p_target_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor uuid := private.require_active_actor();
  request_row private.operation_requests%rowtype;
begin
  if p_result is null then
    raise exception 'operation result is required';
  end if;

  update private.operation_requests r
  set
    target_id = p_target_id,
    result = p_result,
    completed_at = now()
  where r.id = p_operation_id
    and r.actor_id = current_actor
    and r.result is null
  returning r.* into request_row;

  if not found then
    raise exception 'operation could not be completed';
  end if;

  insert into private.operation_audit_log (
    operation_id,
    actor_id,
    connection_id,
    channel,
    tool_name,
    request_id,
    target_id,
    payload_hash
  ) values (
    request_row.id,
    request_row.actor_id,
    request_row.connection_id,
    request_row.channel,
    request_row.tool_name,
    request_row.request_id,
    p_target_id,
    request_row.payload_hash
  );

  return p_result;
end;
$$;

-- Mutation RPCs run as the authenticated caller so business-table RLS still
-- applies. Grant only the helper functions those RPCs need.
grant usage on schema private to authenticated;
grant execute on function private.begin_operation(
  text, uuid, jsonb, text, uuid
) to authenticated;
grant execute on function private.complete_operation(
  uuid, uuid, jsonb
) to authenticated;

revoke execute on function private.mcp_payload_hash(jsonb)
  from public, anon, authenticated;
revoke execute on function private.require_active_actor()
  from public, anon, authenticated;
revoke execute on function private.touch_mcp_connection(text, text, text)
  from public, anon, authenticated;
revoke execute on function private.begin_operation(text, uuid, jsonb, text, uuid)
  from public, anon;
revoke execute on function private.complete_operation(uuid, uuid, jsonb)
  from public, anon;

-- ---------------------------------------------------------------------------
-- Public connection and approval RPCs
-- ---------------------------------------------------------------------------

create function public.mcp_touch_connection(
  p_downstream_client_hash text,
  p_client_name text,
  p_client_uri text default null
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.touch_mcp_connection(
    p_downstream_client_hash,
    p_client_name,
    p_client_uri
  );
$$;

create function public.mcp_prepare_write(
  p_connection_hash text,
  p_client_name text,
  p_client_uri text,
  p_tool_name text,
  p_request_id uuid,
  p_target_id uuid,
  p_payload jsonb
)
returns table (
  approval_token uuid,
  state text,
  expires_at timestamptz,
  payload_hash text,
  completed_result jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor uuid := private.require_active_actor();
  current_connection uuid;
  current_hash text;
  existing_operation private.operation_requests%rowtype;
  intent private.mcp_approval_intents%rowtype;
begin
  if p_tool_name not in (
    'create_task',
    'update_task',
    'archive_task',
    'start_task',
    'submit_work',
    'review_submission'
  ) then
    raise exception 'unsupported operation';
  end if;
  if p_request_id is null then
    raise exception 'request id is required';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a JSON object';
  end if;
  if octet_length(p_payload::text) > 32768 then
    raise exception 'payload is too large';
  end if;

  current_connection := private.touch_mcp_connection(
    p_connection_hash,
    p_client_name,
    p_client_uri
  );
  current_hash := private.mcp_payload_hash(p_payload);

  select r.*
  into existing_operation
  from private.operation_requests r
  where r.actor_id = current_actor
    and r.scope_key = current_connection::text
    and r.request_id = p_request_id;

  if found then
    if existing_operation.tool_name <> p_tool_name
       or existing_operation.payload_hash <> current_hash then
      raise exception 'request id was already used with different input';
    end if;
    if existing_operation.result is null then
      raise exception 'request is incomplete; retry later';
    end if;

    return query select
      null::uuid,
      'completed'::text,
      existing_operation.completed_at,
      current_hash,
      existing_operation.result;
    return;
  end if;

  select a.*
  into intent
  from private.mcp_approval_intents a
  where a.connection_id = current_connection
    and a.tool_name = p_tool_name
    and a.request_id = p_request_id
  for update;

  if found then
    if intent.actor_id <> current_actor or intent.payload_hash <> current_hash then
      raise exception 'request id was already used with different input';
    end if;

    if intent.state = 'denied' then
      return query select
        intent.approval_token,
        intent.state,
        intent.expires_at,
        intent.payload_hash,
        null::jsonb;
      return;
    end if;

    if intent.state = 'consumed' then
      raise exception 'approval was already consumed';
    end if;

    if intent.expires_at <= now() then
      update private.mcp_approval_intents a
      set
        approval_token = gen_random_uuid(),
        target_id = p_target_id,
        payload = p_payload,
        state = 'pending',
        expires_at = now() + interval '5 minutes',
        approved_at = null,
        consumed_at = null
      where a.id = intent.id
      returning a.* into intent;
    end if;

    return query select
      intent.approval_token,
      intent.state,
      intent.expires_at,
      intent.payload_hash,
      null::jsonb;
    return;
  end if;

  insert into private.mcp_approval_intents (
    connection_id,
    actor_id,
    tool_name,
    request_id,
    target_id,
    payload_hash,
    payload
  ) values (
    current_connection,
    current_actor,
    p_tool_name,
    p_request_id,
    p_target_id,
    current_hash,
    p_payload
  )
  returning * into intent;

  return query select
    intent.approval_token,
    intent.state,
    intent.expires_at,
    intent.payload_hash,
    null::jsonb;
end;
$$;

create function public.mcp_approve_write(
  p_connection_hash text,
  p_approval_token uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor uuid := private.require_active_actor();
  oauth_client_id text := nullif(auth.jwt()->>'client_id', '');
  current_connection uuid;
begin
  if oauth_client_id is null then
    raise exception 'an OAuth client token is required';
  end if;

  select c.id
  into current_connection
  from private.mcp_connections c
  where c.user_id = current_actor
    and c.upstream_client_id = oauth_client_id
    and c.downstream_client_hash = p_connection_hash
    and c.revoked_at is null;

  if current_connection is null then
    raise exception 'MCP connection not found or revoked';
  end if;

  update private.mcp_approval_intents a
  set
    state = 'approved',
    approved_at = now()
  where a.approval_token = p_approval_token
    and a.connection_id = current_connection
    and a.actor_id = current_actor
    and a.state = 'pending'
    and a.expires_at > now();

  if not found then
    raise exception 'approval is missing, expired, or already decided';
  end if;

  return true;
end;
$$;

create function public.get_mcp_approval(p_approval_token uuid)
returns table (
  client_name text,
  tool_name text,
  request_id uuid,
  target_id uuid,
  payload jsonb,
  state text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_actor uuid := private.require_active_actor();
begin
  return query
    select
      c.client_name,
      a.tool_name,
      a.request_id,
      a.target_id,
      a.payload,
      a.state,
      a.expires_at
    from private.mcp_approval_intents a
    join private.mcp_connections c on c.id = a.connection_id
    where a.approval_token = p_approval_token
      and a.actor_id = current_actor
      and c.revoked_at is null;
end;
$$;

create function public.decide_mcp_approval(
  p_approval_token uuid,
  p_decision text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor uuid := private.require_active_actor();
begin
  if p_decision not in ('approve', 'deny') then
    raise exception 'decision must be approve or deny';
  end if;

  update private.mcp_approval_intents a
  set
    state = case when p_decision = 'approve' then 'approved' else 'denied' end,
    approved_at = case when p_decision = 'approve' then now() else null end
  where a.approval_token = p_approval_token
    and a.actor_id = current_actor
    and a.state = 'pending'
    and a.expires_at > now();

  if not found then
    raise exception 'approval is missing, expired, or already decided';
  end if;

  return true;
end;
$$;

create function public.list_mcp_connections()
returns table (
  id uuid,
  client_name text,
  client_uri text,
  created_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.client_name,
    c.client_uri,
    c.created_at,
    c.last_seen_at,
    c.revoked_at
  from private.mcp_connections c
  where c.user_id = private.require_active_actor()
  order by c.last_seen_at desc;
$$;

create function public.revoke_mcp_connection(p_connection_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor uuid := private.require_active_actor();
begin
  update private.mcp_connections c
  set revoked_at = coalesce(c.revoked_at, now())
  where c.id = p_connection_id
    and c.user_id = current_actor;

  if not found then
    raise exception 'connection not found';
  end if;

  update private.mcp_approval_intents a
  set state = 'denied'
  where a.connection_id = p_connection_id
    and a.actor_id = current_actor
    and a.state = 'pending';

  return true;
end;
$$;

revoke execute on function public.mcp_touch_connection(text, text, text)
  from public, anon;
revoke execute on function public.mcp_prepare_write(
  text, text, text, text, uuid, uuid, jsonb
) from public, anon;
revoke execute on function public.mcp_approve_write(text, uuid)
  from public, anon;
revoke execute on function public.get_mcp_approval(uuid)
  from public, anon;
revoke execute on function public.decide_mcp_approval(uuid, text)
  from public, anon;
revoke execute on function public.list_mcp_connections()
  from public, anon;
revoke execute on function public.revoke_mcp_connection(uuid)
  from public, anon;

grant execute on function public.mcp_touch_connection(text, text, text)
  to authenticated;
grant execute on function public.mcp_prepare_write(
  text, text, text, text, uuid, uuid, jsonb
) to authenticated;
grant execute on function public.mcp_approve_write(text, uuid)
  to authenticated;
grant execute on function public.get_mcp_approval(uuid)
  to authenticated;
grant execute on function public.decide_mcp_approval(uuid, text)
  to authenticated;
grant execute on function public.list_mcp_connections()
  to authenticated;
grant execute on function public.revoke_mcp_connection(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Overdue maintenance: system-only Cron instead of authenticated page loads
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;

create or replace function public.flag_overdue_tasks()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    raise exception 'overdue maintenance is system-only';
  end if;

  perform set_config('meritly.system_update', 'true', true);
  update public.tasks
  set status = 'overdue'
  where deadline < now()
    and status in ('pending', 'in_progress', 'needs_revision')
    and deleted_at is null;
  perform set_config('meritly.system_update', 'false', true);
end;
$$;

revoke execute on function public.flag_overdue_tasks()
  from public, anon, authenticated;

do $$
declare
  existing_job bigint;
begin
  select jobid
  into existing_job
  from cron.job
  where jobname = 'meritly-flag-overdue-tasks';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'meritly-flag-overdue-tasks',
    '*/5 * * * *',
    'select public.flag_overdue_tasks()'
  );
end;
$$;
