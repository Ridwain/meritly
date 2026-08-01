-- Harden browser path validation and allow safe idempotent resolution.
-- Consumed uploads can be resolved only so the original completed request can replay.

create or replace function public.mcp_complete_upload(
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
