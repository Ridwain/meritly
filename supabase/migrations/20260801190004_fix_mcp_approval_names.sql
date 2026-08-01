-- Avoid PL/pgSQL variable/column ambiguity across approval RPCs.
-- Descriptive local names keep actor and connection values unambiguous.

create or replace function public.mcp_prepare_write(
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

create or replace function public.get_mcp_approval(p_approval_token uuid)
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

create or replace function public.decide_mcp_approval(
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
  set state = 'denied'
  where a.connection_id = p_connection_id
    and a.actor_id = current_actor
    and a.state = 'pending';

  return true;
end;
$$;
