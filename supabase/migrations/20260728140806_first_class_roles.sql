-- Feature 11: make roles first-class capabilities instead of magic names.

-- Each flag describes one security-relevant property of a role.
alter table public.roles
  add column assignable_work boolean not null default false,
  add column protected boolean not null default false,
  add column hr_grantable boolean not null default false;

-- Role names are stable machine identifiers; labels can be prettified in the UI.
alter table public.roles
  add constraint roles_name_identifier_check
  check (name ~ '^[a-z][a-z0-9_]{0,31}$');

update public.roles set assignable_work = true where name = 'employee';
update public.roles set protected = true where name = 'admin';
update public.roles set hr_grantable = true where name = 'hr';

-- These foreign keys are used repeatedly by RBAC lookups and permission editing.
create index profiles_role_id_idx on public.profiles (role_id);
create index role_permissions_permission_id_idx
  on public.role_permissions (permission_id);

-- Protected roles are seed-only. A worker role cannot be disabled while it still
-- owns open work, because that would make those assignees invalid mid-task.
create or replace function public.protect_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.protected then
      raise exception 'protected roles cannot be deleted';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.protected then
      raise exception 'cannot create protected roles';
    end if;
    return new;
  end if;

  if old.protected or new.protected then
    raise exception 'protected roles cannot be modified';
  end if;

  if old.assignable_work and not new.assignable_work
     and exists (
       select 1
       from public.profiles p
       join public.tasks t on t.assigned_to = p.id
       where p.role_id = old.id
         and t.deleted_at is null
         and t.status in (
           'pending',
           'in_progress',
           'submitted',
           'needs_revision',
           'overdue'
         )
     ) then
    raise exception 'worker roles with open tasks cannot stop accepting work';
  end if;

  return new;
end;
$$;

create trigger protect_roles
before insert or update or delete on public.roles
for each row execute function public.protect_roles();

revoke execute on function public.protect_roles() from anon, authenticated, public;

-- The protected role's permission keyring is immutable through the API too.
create or replace function public.protect_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role_id integer;
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  target_role_id := case when tg_op = 'DELETE' then old.role_id else new.role_id end;

  if exists (
    select 1
    from public.roles r
    where r.id = target_role_id and r.protected
  ) then
    raise exception 'protected role permissions cannot be modified';
  end if;

  if tg_op = 'UPDATE' and new.role_id is distinct from old.role_id
     and exists (
       select 1
       from public.roles r
       where r.id = old.role_id and r.protected
     ) then
    raise exception 'protected role permissions cannot be modified';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger protect_role_permissions
before insert or update or delete on public.role_permissions
for each row execute function public.protect_role_permissions();

revoke execute on function public.protect_role_permissions()
  from anon, authenticated, public;

-- Permission definitions are code-owned. Admins manage role keyrings, not keys.
drop policy "permissions_write" on public.permissions;

-- Split write policies by action so SELECT does not evaluate write policies.
drop policy "roles_write" on public.roles;
create policy "roles_insert" on public.roles
  for insert to authenticated
  with check ((select public.has_permission('role.manage')));
create policy "roles_update" on public.roles
  for update to authenticated
  using ((select public.has_permission('role.manage')))
  with check ((select public.has_permission('role.manage')));
create policy "roles_delete" on public.roles
  for delete to authenticated
  using ((select public.has_permission('role.manage')));

drop policy "role_permissions_write" on public.role_permissions;
create policy "role_permissions_insert" on public.role_permissions
  for insert to authenticated
  with check ((select public.has_permission('role.manage')));
create policy "role_permissions_delete" on public.role_permissions
  for delete to authenticated
  using ((select public.has_permission('role.manage')));

-- "Assignable" now means the role has the worker capability, regardless of name.
create or replace function public.is_assignable_employee(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = target
      and p.deleted_at is null
      and r.assignable_work
      and p.accepted_at is not null
  );
$$;

revoke execute on function public.is_assignable_employee(uuid) from anon, public;
grant execute on function public.is_assignable_employee(uuid) to authenticated;

create or replace function public.assignable_employees()
returns table (id uuid, full_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (
    public.has_permission('task.create')
    or public.has_permission('task.update')
  ) then
    raise exception 'not allowed to list assignable employees';
  end if;

  return query
    select p.id, p.full_name
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.deleted_at is null
      and r.assignable_work
      and p.accepted_at is not null
    order by p.full_name;
end;
$$;

revoke execute on function public.assignable_employees() from anon, public;
grant execute on function public.assignable_employees() to authenticated;

-- Profile role changes and archiving now use role attributes rather than names.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_assignable boolean;
  new_protected boolean;
  new_hr_grantable boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'profile id cannot change';
  end if;

  if new.role_id is distinct from old.role_id then
    select r.protected, r.hr_grantable
      into new_protected, new_hr_grantable
      from public.roles r
      where r.id = new.role_id;

    select r.assignable_work
      into old_assignable
      from public.roles r
      where r.id = old.role_id;

    if coalesce(new_protected, false) then
      raise exception 'protected roles cannot be assigned';
    end if;
    if old.id = auth.uid() then
      raise exception 'you cannot change your own role';
    end if;

    if public.has_permission('user.manage_all') then
      null;
    elsif public.has_permission('user.promote')
          and coalesce(old_assignable, false)
          and coalesce(new_hr_grantable, false) then
      null;
    else
      raise exception 'not allowed to change this user''s role';
    end if;
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    select r.assignable_work
      into old_assignable
      from public.roles r
      where r.id = old.role_id;

    if old.id = auth.uid() then
      raise exception 'you cannot archive yourself';
    end if;

    if public.has_permission('user.manage_all') then
      null;
    elsif public.has_permission('user.archive')
          and coalesce(old_assignable, false) then
      null;
    else
      raise exception 'not allowed to archive or restore this user';
    end if;
  end if;

  if new.accepted_at is distinct from old.accepted_at then
    if old.id <> auth.uid() then
      raise exception 'only the account owner may accept their own invite';
    end if;
    if old.accepted_at is not null then
      raise exception 'accepted_at cannot be changed once set';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_profile_columns()
  from anon, authenticated, public;

drop policy "profiles_update_manage" on public.profiles;
create policy "profiles_update_manage" on public.profiles
  for update to authenticated
  using (
    id <> (select auth.uid())
    and (
      (select public.has_permission('user.manage_all'))
      or (
        (
          (select public.has_permission('user.promote'))
          or (select public.has_permission('user.archive'))
        )
        and role_id in (
          select r.id from public.roles r where r.assignable_work
        )
      )
    )
  )
  with check (
    id <> (select auth.uid())
    and (
      (select public.has_permission('user.manage_all'))
      or (select public.has_permission('user.promote'))
      or (select public.has_permission('user.archive'))
    )
  );

-- User and performance managers need the same worker list, even if they cannot
-- invite. Full managers see all non-self users; other capabilities see workers.
drop function public.admin_list_users();

create function public.admin_list_users()
returns table (
  id uuid,
  full_name text,
  role text,
  email text,
  deleted_at timestamptz,
  accepted boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  can_manage_all boolean := public.has_permission('user.manage_all');
begin
  if not (
    can_manage_all
    or public.has_permission('user.invite')
    or public.has_permission('user.promote')
    or public.has_permission('user.archive')
    or public.has_permission('stats.view_all')
  ) then
    raise exception 'not allowed to list users';
  end if;

  return query
    select p.id, p.full_name, r.name, u.email::text, p.deleted_at,
           (p.accepted_at is not null) as accepted
    from public.profiles p
    join public.roles r on r.id = p.role_id
    join auth.users u on u.id = p.id
    where p.id <> auth.uid()
      and (can_manage_all or r.assignable_work)
    order by p.created_at;
end;
$$;

revoke execute on function public.admin_list_users() from anon, public;
grant execute on function public.admin_list_users() to authenticated;

-- A role that can edit existing tasks must also be able to upload replacements.
drop policy "task_attachments_upload" on storage.objects;
create policy "task_attachments_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-attachments'
    and (select public.is_active())
    and (
      (select public.has_permission('task.create'))
      or (select public.has_permission('task.update'))
    )
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
