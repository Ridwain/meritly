-- Migration 11: track invite acceptance explicitly (accepted_at), instead of
-- inferring it from auth.users.encrypted_password.
--
-- Bug found: Supabase's invite link is a one-time LOGIN token. The moment it
-- is opened (verified by Supabase's auth server), encrypted_password and
-- confirmed_at are already set — before the person ever sees or submits our
-- "set your password" form. So `has_password` (used everywhere as a proxy for
-- "accepted the invite") could already be true from merely opening the email,
-- letting someone show as "Active" / become assignable before they'd done
-- anything in our app.
--
-- Fix: record the ONE moment that actually matters — when they submit the
-- new-password form — as profiles.accepted_at, set by the app itself, and
-- use that everywhere instead.

alter table public.profiles add column accepted_at timestamptz;

-- Backfill: anyone who already has a usable account today (encrypted_password
-- set) is grandfathered in as already-accepted, using their confirmed_at as
-- the accepted time. Approximation for legacy rows only; every invite from
-- now on gets a precise, trustworthy accepted_at.
update public.profiles p
set accepted_at = u.confirmed_at
from auth.users u
where u.id = p.id
  and u.encrypted_password is not null
  and u.encrypted_password <> ''
  and p.accepted_at is null;

-- Re-create the profiles column-pinning trigger, adding a guard for
-- accepted_at: only the row's own owner may set it, and only once
-- (null -> a timestamp; never editable afterward).
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  employee_role_id int := (select id from public.roles where name = 'employee');
  new_role_name text;
begin
  if auth.uid() is null then return new; end if;

  if new.id is distinct from old.id then
    raise exception 'profile id cannot change';
  end if;

  if new.role_id is distinct from old.role_id then
    select r.name into new_role_name from public.roles r where r.id = new.role_id;
    if new_role_name = 'admin' then
      raise exception 'the admin role cannot be assigned';
    end if;
    if old.id = auth.uid() then
      raise exception 'you cannot change your own role';
    end if;
    if public.has_permission('user.manage_all') then
      null;
    elsif public.has_permission('user.promote')
          and old.role_id = employee_role_id then
      null;
    else
      raise exception 'not allowed to change this user''s role';
    end if;
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    if old.id = auth.uid() then
      raise exception 'you cannot archive yourself';
    end if;
    if public.has_permission('user.manage_all') then
      null;
    elsif public.has_permission('user.archive')
          and old.role_id = employee_role_id then
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

-- Task assignability now checks accepted_at, not encrypted_password. Also
-- simpler: no longer needs to join auth.users at all.
create or replace function public.is_assignable_employee(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = target
      and p.deleted_at is null
      and r.name = 'employee'
      and p.accepted_at is not null
  );
$$;

create or replace function public.assignable_employees()
returns table (id uuid, full_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('task.create') then
    raise exception 'not allowed to list assignable employees';
  end if;
  return query
    select p.id, p.full_name
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.deleted_at is null
      and r.name = 'employee'
      and p.accepted_at is not null
    order by p.full_name;
end;
$$;

-- Users panel: report real acceptance instead of the unreliable password flag.
-- DROP+CREATE (not REPLACE) because Postgres won't let CREATE OR REPLACE
-- change a function's return columns; the grants are reapplied after.
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
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('user.invite') then
    raise exception 'not allowed to list users';
  end if;
  return query
    select p.id, p.full_name, r.name, u.email::text, p.deleted_at,
           (p.accepted_at is not null) as accepted
    from public.profiles p
    join public.roles r on r.id = p.role_id
    join auth.users u on u.id = p.id
    where p.id <> auth.uid()
      and (
        public.has_permission('user.manage_all')
        or r.name = 'employee'
      )
    order by p.created_at;
end;
$$;

revoke execute on function public.admin_list_users() from anon, public;
grant execute on function public.admin_list_users() to authenticated;
