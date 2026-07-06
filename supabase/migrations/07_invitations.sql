-- Feature 3.5: invitations + user management

-- New permission: who may invite people. HR + admin.
insert into public.permissions (key) values ('user.invite')
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.name in ('hr','admin') and p.key = 'user.invite'
on conflict do nothing;

-- The Users panel needs each account's email + whether they've set a password
-- yet (to show "invited / pending"). Email lives in auth.users, so this is a
-- SECURITY DEFINER function, gated to callers who hold user.invite.
create or replace function public.admin_list_users()
returns table (
  id uuid,
  full_name text,
  role text,
  email text,
  deleted_at timestamptz,
  has_password boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('user.invite') then
    raise exception 'not allowed to list users';
  end if;
  return query
    select p.id, p.full_name, r.name, u.email::text, p.deleted_at,
           (u.encrypted_password is not null and u.encrypted_password <> '') as has_password
    from public.profiles p
    join public.roles r on r.id = p.role_id
    join auth.users u on u.id = p.id
    order by p.created_at;
end;
$$;

revoke execute on function public.admin_list_users() from anon, public;
grant execute on function public.admin_list_users() to authenticated;
