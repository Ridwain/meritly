-- Meritly MCP v1: short-lived browser upload bridge and atomic consumption.

create table private.mcp_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  upload_token uuid not null unique default gen_random_uuid(),
  connection_id uuid not null
    references private.mcp_connections(id) on delete restrict,
  actor_id uuid not null
    references public.profiles(id) on delete restrict,
  purpose text not null
    check (purpose in ('task_attachment', 'submission')),
  target_task_id uuid
    references public.tasks(id) on delete restrict,
  state text not null default 'pending'
    check (state in ('pending', 'uploaded', 'consumed', 'expired')),
  object_path text unique,
  original_filename text,
  content_type text,
  byte_size bigint,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  uploaded_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (purpose = 'submission' and target_task_id is not null)
    or purpose = 'task_attachment'
  ),
  check (
    (state = 'pending'
      and object_path is null
      and original_filename is null
      and content_type is null
      and byte_size is null
      and uploaded_at is null
      and consumed_at is null)
    or
    (state = 'uploaded'
      and object_path is not null
      and original_filename is not null
      and content_type is not null
      and byte_size between 1 and 10485760
      and uploaded_at is not null
      and consumed_at is null)
    or
    (state = 'consumed'
      and object_path is not null
      and original_filename is not null
      and content_type is not null
      and byte_size between 1 and 10485760
      and uploaded_at is not null
      and consumed_at is not null)
    or state = 'expired'
  )
);

create index mcp_upload_actor_active_idx
  on private.mcp_upload_sessions (actor_id, expires_at)
  where state in ('pending', 'uploaded');
create index mcp_upload_connection_active_idx
  on private.mcp_upload_sessions (connection_id, expires_at)
  where state in ('pending', 'uploaded');

-- One private object may provide evidence for only one business row.
create unique index tasks_attachment_path_unique
  on public.tasks (attachment_path)
  where attachment_path is not null;
create unique index submissions_file_path_unique
  on public.submissions (file_path)
  where file_path is not null;

alter table private.mcp_upload_sessions enable row level security;
revoke all on table private.mcp_upload_sessions
  from public, anon, authenticated;

create function public.mcp_prepare_upload(
  p_connection_hash text,
  p_client_name text,
  p_client_uri text,
  p_purpose text,
  p_target_task_id uuid default null
)
returns table (
  upload_token uuid,
  state text,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor uuid := private.require_active_actor();
  current_connection uuid;
  new_upload private.mcp_upload_sessions%rowtype;
begin
  if p_purpose not in ('task_attachment', 'submission') then
    raise exception 'invalid upload purpose';
  end if;

  current_connection := private.touch_mcp_connection(
    p_connection_hash,
    p_client_name,
    p_client_uri
  );

  if p_purpose = 'submission' then
    if p_target_task_id is null
       or not public.has_permission('submission.create')
       or not public.is_active()
       or not exists (
         select 1
         from public.tasks t
         where t.id = p_target_task_id
           and t.assigned_to = current_actor
           and t.deleted_at is null
           and t.status in ('in_progress', 'needs_revision', 'overdue')
       ) then
      raise exception 'task not found or inaccessible';
    end if;
  elsif p_target_task_id is null then
    if not public.has_permission('task.create') then
      raise exception 'not allowed to create task attachments';
    end if;
  elsif not public.has_permission('task.view_all')
        or not public.has_permission('task.update')
        or not exists (
          select 1
          from public.tasks t
          where t.id = p_target_task_id
            and t.deleted_at is null
            and private.can_access_user(t.assigned_to)
        ) then
    raise exception 'task not found or inaccessible';
  end if;

  insert into private.mcp_upload_sessions (
    connection_id,
    actor_id,
    purpose,
    target_task_id
  ) values (
    current_connection,
    current_actor,
    p_purpose,
    p_target_task_id
  )
  returning * into new_upload;

  return query select
    new_upload.upload_token,
    new_upload.state,
    new_upload.expires_at;
end;
$$;

create function public.get_mcp_upload(p_upload_token uuid)
returns table (
  client_name text,
  purpose text,
  target_task_id uuid,
  state text,
  original_filename text,
  content_type text,
  byte_size bigint,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.client_name,
    u.purpose,
    u.target_task_id,
    case
      when u.state in ('pending', 'uploaded') and u.expires_at <= now()
        then 'expired'
      else u.state
    end,
    u.original_filename,
    u.content_type,
    u.byte_size,
    u.expires_at
  from private.mcp_upload_sessions u
  join private.mcp_connections c on c.id = u.connection_id
  where u.upload_token = p_upload_token
    and u.actor_id = private.require_active_actor()
    and c.revoked_at is null;
$$;

create function public.mcp_complete_upload(
  p_upload_token uuid,
  p_object_path text,
  p_original_filename text,
  p_content_type text,
  p_byte_size bigint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_actor uuid := private.require_active_actor();
  upload_row private.mcp_upload_sessions%rowtype;
  bucket_name text;
begin
  select u.*
  into upload_row
  from private.mcp_upload_sessions u
  join private.mcp_connections c on c.id = u.connection_id
  where u.upload_token = p_upload_token
    and u.actor_id = current_actor
    and c.revoked_at is null
  for update of u;

  if not found
     or upload_row.state <> 'pending'
     or upload_row.expires_at <= now() then
    raise exception 'upload session is unavailable or expired';
  end if;
  if p_byte_size is null or p_byte_size not between 1 and 10485760 then
    raise exception 'file size must be between 1 byte and 10 MB';
  end if;
  if p_original_filename is null
     or char_length(p_original_filename) not between 1 and 180
     or p_original_filename ~ '[[:cntrl:]/\\]' then
    raise exception 'invalid file name';
  end if;
  if p_content_type is null or p_content_type not in (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'application/zip'
  ) then
    raise exception 'invalid file type';
  end if;
  if p_object_path is null
     or char_length(p_object_path) > 1024
     or p_object_path like '/%'
     or p_object_path ~ '(^|/)\.\.(/|$)'
     or p_object_path not like (
       current_actor::text || '/' || upload_row.upload_token::text || '/%'
     ) then
    raise exception 'invalid upload path';
  end if;

  bucket_name := case
    when upload_row.purpose = 'submission' then 'submissions'
    else 'task-attachments'
  end;
  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = bucket_name
      and o.name = p_object_path
  ) then
    raise exception 'uploaded file not found';
  end if;

  update private.mcp_upload_sessions u
  set
    state = 'uploaded',
    object_path = p_object_path,
    original_filename = p_original_filename,
    content_type = p_content_type,
    byte_size = p_byte_size,
    uploaded_at = now()
  where u.id = upload_row.id;

  return true;
end;
$$;

create function public.mcp_resolve_upload(
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

revoke execute on function public.mcp_prepare_upload(
  text, text, text, text, uuid
) from public, anon;
revoke execute on function public.get_mcp_upload(uuid)
  from public, anon;
revoke execute on function public.mcp_complete_upload(
  uuid, text, text, text, bigint
) from public, anon;
revoke execute on function public.mcp_resolve_upload(
  text, uuid, text, uuid
) from public, anon;

grant execute on function public.mcp_prepare_upload(
  text, text, text, text, uuid
) to authenticated;
grant execute on function public.get_mcp_upload(uuid)
  to authenticated;
grant execute on function public.mcp_complete_upload(
  uuid, text, text, text, bigint
) to authenticated;
grant execute on function public.mcp_resolve_upload(
  text, uuid, text, uuid
) to authenticated;

-- MCP writes set two transaction-local values in begin_operation(). The
-- business-row trigger consumes exactly the matching upload in that same commit.
create function private.consume_mcp_upload_reference()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_connection uuid := nullif(
    current_setting('meritly.mcp_connection_id', true),
    ''
  )::uuid;
  current_tool text := nullif(
    current_setting('meritly.mcp_tool_name', true),
    ''
  );
  referenced_path text;
  expected_purpose text;
  expected_task_id uuid;
begin
  if current_connection is null then
    return new;
  end if;

  if tg_table_name = 'tasks' then
    if tg_op = 'UPDATE'
       and new.attachment_path is not distinct from old.attachment_path then
      return new;
    end if;
    referenced_path := new.attachment_path;
    expected_purpose := 'task_attachment';
    expected_task_id := case
      when current_tool = 'update_task' then new.id
      else null
    end;
    if current_tool not in ('create_task', 'update_task') then
      raise exception 'MCP upload does not match this operation';
    end if;
  else
    referenced_path := new.file_path;
    expected_purpose := 'submission';
    expected_task_id := new.task_id;
    if current_tool <> 'submit_work' then
      raise exception 'MCP upload does not match this operation';
    end if;
  end if;

  if referenced_path is null then
    return new;
  end if;

  update private.mcp_upload_sessions u
  set
    state = 'consumed',
    consumed_at = now()
  where u.connection_id = current_connection
    and u.actor_id = auth.uid()
    and u.purpose = expected_purpose
    and u.target_task_id is not distinct from expected_task_id
    and u.object_path = referenced_path
    and u.state = 'uploaded'
    and u.expires_at > now();

  if not found then
    raise exception 'MCP upload is missing, expired, changed, or already used';
  end if;
  return new;
end;
$$;

revoke execute on function private.consume_mcp_upload_reference()
  from public, anon, authenticated;

create trigger consume_mcp_task_upload
after insert or update of attachment_path on public.tasks
for each row execute function private.consume_mcp_upload_reference();

create trigger consume_mcp_submission_upload
after insert on public.submissions
for each row execute function private.consume_mcp_upload_reference();

-- Record the exact MCP connection and tool for the row triggers above.
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
