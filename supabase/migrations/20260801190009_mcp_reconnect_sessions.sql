-- Bind each MCP connection to the trusted Supabase OAuth session that created it.
-- A revoked session stays blocked, while a fresh OAuth authorization can safely
-- replace it without erasing the previous audit trail.

alter table private.mcp_connections
  add column oauth_session_id uuid;

-- Existing rows predate session binding. Their own IDs are safe legacy sentinels:
-- the next valid MCP request will replace the active legacy row with a real
-- auth.sessions ID, while already-revoked rows remain historical records.
update private.mcp_connections
set oauth_session_id = id
where oauth_session_id is null;

alter table private.mcp_connections
  alter column oauth_session_id set not null;

alter table private.mcp_connections
  drop constraint if exists
    mcp_connections_user_id_upstream_client_id_downstream_client_hash_key;

-- PostgreSQL truncates automatically-generated identifiers to 63 bytes.
alter table private.mcp_connections
  drop constraint if exists
    mcp_connections_user_id_upstream_client_id_downstream_clien_key;

alter table private.mcp_connections
  add constraint mcp_connections_session_identity_key unique (
    user_id,
    upstream_client_id,
    downstream_client_hash,
    oauth_session_id
  );

-- One Meritly account has at most one active authorization per downstream app.
create unique index mcp_connections_one_active_client_idx
  on private.mcp_connections (
    user_id,
    upstream_client_id,
    downstream_client_hash
  )
  where revoked_at is null;

create function private.require_active_oauth_session(
  p_actor_id uuid,
  p_oauth_client_id text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw_session_id text := nullif(auth.jwt()->>'session_id', '');
  current_session_id uuid;
begin
  if raw_session_id is null
     or raw_session_id !~* (
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-'
       || '[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     ) then
    raise exception 'an active OAuth session is required';
  end if;

  current_session_id := raw_session_id::uuid;

  if not exists (
    select 1
    from auth.sessions s
    where s.id = current_session_id
      and s.user_id = p_actor_id
      and s.oauth_client_id is not null
      and s.oauth_client_id::text = p_oauth_client_id
  ) then
    raise exception 'OAuth session is no longer active';
  end if;

  return current_session_id;
end;
$$;

revoke execute on function private.require_active_oauth_session(uuid, text)
  from public, anon, authenticated;

create or replace function private.touch_mcp_connection(
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
  current_actor uuid := private.require_active_actor();
  current_oauth_client_id text := nullif(auth.jwt()->>'client_id', '');
  current_session_id uuid;
  clean_name text := btrim(coalesce(p_client_name, ''));
  clean_uri text := nullif(btrim(coalesce(p_client_uri, '')), '');
  connection_id uuid;
  connection_revoked_at timestamptz;
begin
  if current_oauth_client_id is null then
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

  current_session_id := private.require_active_oauth_session(
    current_actor,
    current_oauth_client_id
  );

  -- Serialize reconnects for this user/app identity. Hash collisions only cause
  -- harmless extra serialization; the unique index remains the final guard.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      current_actor::text
      || ':' || current_oauth_client_id
      || ':' || p_downstream_client_hash,
      0
    )
  );

  select c.id, c.revoked_at
  into connection_id, connection_revoked_at
  from private.mcp_connections c
  where c.user_id = current_actor
    and c.upstream_client_id = current_oauth_client_id
    and c.downstream_client_hash = p_downstream_client_hash
    and c.oauth_session_id = current_session_id
  for update;

  if found then
    if connection_revoked_at is not null then
      raise exception 'this MCP connection has been revoked';
    end if;

    update private.mcp_connections c
    set
      client_name = clean_name,
      client_uri = clean_uri,
      last_seen_at = now()
    where c.id = connection_id;

    return connection_id;
  end if;

  -- A fresh OAuth session supersedes any older authorization for the same app.
  update private.mcp_approval_intents a
  set
    state = 'denied',
    approved_at = null
  where a.connection_id in (
    select c.id
    from private.mcp_connections c
    where c.user_id = current_actor
      and c.upstream_client_id = current_oauth_client_id
      and c.downstream_client_hash = p_downstream_client_hash
      and c.revoked_at is null
  )
    and a.state in ('pending', 'approved');

  update private.mcp_upload_sessions u
  set state = 'expired'
  where u.connection_id in (
    select c.id
    from private.mcp_connections c
    where c.user_id = current_actor
      and c.upstream_client_id = current_oauth_client_id
      and c.downstream_client_hash = p_downstream_client_hash
      and c.revoked_at is null
  )
    and u.state in ('pending', 'uploaded');

  update private.mcp_connections c
  set revoked_at = now()
  where c.user_id = current_actor
    and c.upstream_client_id = current_oauth_client_id
    and c.downstream_client_hash = p_downstream_client_hash
    and c.revoked_at is null;

  insert into private.mcp_connections (
    user_id,
    upstream_client_id,
    downstream_client_hash,
    oauth_session_id,
    client_name,
    client_uri
  ) values (
    current_actor,
    current_oauth_client_id,
    p_downstream_client_hash,
    current_session_id,
    clean_name,
    clean_uri
  )
  returning id into connection_id;

  return connection_id;
end;
$$;

create or replace function private.begin_operation(
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
  current_session_id uuid;
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

    current_session_id := private.require_active_oauth_session(
      current_actor,
      oauth_client_id
    );

    select c.id
    into current_connection
    from private.mcp_connections c
    where c.user_id = current_actor
      and c.upstream_client_id = oauth_client_id
      and c.downstream_client_hash = p_connection_hash
      and c.oauth_session_id = current_session_id
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

create or replace function public.mcp_approve_write(
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
  current_session_id uuid;
  current_connection uuid;
begin
  if oauth_client_id is null then
    raise exception 'an OAuth client token is required';
  end if;

  current_session_id := private.require_active_oauth_session(
    current_actor,
    oauth_client_id
  );

  select c.id
  into current_connection
  from private.mcp_connections c
  where c.user_id = current_actor
    and c.upstream_client_id = oauth_client_id
    and c.downstream_client_hash = p_connection_hash
    and c.oauth_session_id = current_session_id
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

create or replace function public.mcp_resolve_upload(
  p_connection_hash text,
  p_upload_token uuid,
  p_purpose text,
  p_target_task_id uuid default null
)
returns table (
  object_path text,
  original_filename text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_actor uuid := private.require_active_actor();
  oauth_client_id text := nullif(auth.jwt()->>'client_id', '');
  current_session_id uuid;
  current_connection uuid;
begin
  if oauth_client_id is null then
    raise exception 'an OAuth client token is required';
  end if;

  current_session_id := private.require_active_oauth_session(
    current_actor,
    oauth_client_id
  );

  select c.id
  into current_connection
  from private.mcp_connections c
  where c.user_id = current_actor
    and c.upstream_client_id = oauth_client_id
    and c.downstream_client_hash = p_connection_hash
    and c.oauth_session_id = current_session_id
    and c.revoked_at is null;
  if current_connection is null then
    raise exception 'MCP connection not found or revoked';
  end if;

  return query
    select u.object_path, u.original_filename
    from private.mcp_upload_sessions u
    where u.upload_token = p_upload_token
      and u.connection_id = current_connection
      and u.actor_id = current_actor
      and u.purpose = p_purpose
      and u.target_task_id is not distinct from p_target_task_id
      and (
        (u.state = 'uploaded' and u.expires_at > now())
        or u.state = 'consumed'
      );

  if not found then
    raise exception 'upload session is unavailable or expired';
  end if;
end;
$$;

create or replace function public.list_mcp_connections()
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
    and c.revoked_at is null
  order by c.last_seen_at desc;
$$;

create or replace function public.revoke_mcp_connection(p_connection_id uuid)
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
  set
    state = 'denied',
    approved_at = null
  where a.connection_id = p_connection_id
    and a.actor_id = current_actor
    and a.state in ('pending', 'approved');

  update private.mcp_upload_sessions u
  set state = 'expired'
  where u.connection_id = p_connection_id
    and u.actor_id = current_actor
    and u.state in ('pending', 'uploaded');

  return true;
end;
$$;
