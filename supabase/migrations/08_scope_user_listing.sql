-- Migration 8: scope the user-management listing to who the caller can manage.
--   - Everyone: never list yourself.
--   - Admin (user.manage_all): sees all other users.
--   - HR (user.invite only): sees employees only (not other HRs, not the admin).
-- Enforced here in the DB function so it also scopes EMAIL exposure — not a
-- cosmetic UI filter.
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
    where p.id <> auth.uid()                       -- never yourself
      and (
        public.has_permission('user.manage_all')   -- admin: everyone else
        or r.name = 'employee'                      -- HR: employees only
      )
    order by p.created_at;
end;
$$;
