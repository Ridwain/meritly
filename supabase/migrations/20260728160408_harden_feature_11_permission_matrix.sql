-- Feature 11 permission-audit follow-up.
-- Active users may inspect the RBAC catalogue; archived sessions may only read
-- their own profile so the dashboard can show the deactivation redirect.

drop policy "roles_select" on public.roles;
create policy "roles_select" on public.roles
  for select to authenticated
  using ((select public.is_active()));

drop policy "permissions_select" on public.permissions;
create policy "permissions_select" on public.permissions
  for select to authenticated
  using ((select public.is_active()));

drop policy "role_permissions_select" on public.role_permissions;
create policy "role_permissions_select" on public.role_permissions
  for select to authenticated
  using ((select public.is_active()));

-- Convenience RPCs must follow the same archived-user rule as has_permission().
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.name
  from public.profiles pr
  join public.roles r on r.id = pr.role_id
  where pr.id = auth.uid()
    and pr.deleted_at is null;
$$;

revoke execute on function public.my_role() from anon, public;
grant execute on function public.my_role() to authenticated;

-- Ratings are employee-performance records. A holder may author a rating only
-- for another active, accepted worker; the caller identity cannot be forged.
drop policy "ratings_insert" on public.ratings;
create policy "ratings_insert" on public.ratings
  for insert to authenticated
  with check (
    (select public.has_permission('rating.create'))
    and rated_by = (select auth.uid())
    and employee_id <> (select auth.uid())
    and public.is_assignable_employee(employee_id)
  );
