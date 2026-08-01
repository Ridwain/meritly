-- Keep the OAuth client claim distinct from the connection table column.
-- This removes the remaining PL/pgSQL ambiguity in MCP-channel writes.

-- Fix PL/pgSQL output-column ambiguity in the idempotency conflict clause.
-- The explicit constraint name makes the intended unique key unambiguous.

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
