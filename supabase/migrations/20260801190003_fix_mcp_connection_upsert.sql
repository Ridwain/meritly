-- Avoid PL/pgSQL variable/column ambiguity in the connection upsert.
-- The local OAuth claim now has a name distinct from the table column.

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
