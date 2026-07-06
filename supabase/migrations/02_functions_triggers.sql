-- Migration 2: functions & triggers (DESIGN.md v1.7 §3–§4)
--
-- SECURITY DEFINER = "run with the function owner's power, skipping RLS
-- inside the function only". Needed because these helpers read profiles,
-- whose own policies call these helpers — DEFINER breaks the recursion.
--
-- auth.uid() IS NULL means the caller is not an API user (it's direct SQL:
-- the postgres role or service key). Those bypass the pinning triggers —
-- RLS already doesn't apply to them; the triggers guard API users.

-- ============ Helper functions ============

-- Am I (the caller) an active, non-archived user?
create or replace function public.is_active()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and deleted_at is null
  );
$$;

-- THE security pivot: does my role's keyring hold this key?
-- Archived users hold no permissions (deleted_at check built in).
create or replace function public.has_permission(perm text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles pr
    join public.role_permissions rp on rp.role_id = pr.role_id
    join public.permissions p on p.id = rp.permission_id
    where pr.id = auth.uid()
      and pr.deleted_at is null
      and p.key = perm
  );
$$;

-- Convenience for the app (sidebar variant, etc.)
create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public as $$
  select r.name
  from public.profiles pr
  join public.roles r on r.id = pr.role_id
  where pr.id = auth.uid();
$$;

-- ============ Signup trigger ============

-- Fires when Supabase Auth creates a user. Guarantees the profile exists
-- (no half-failed signups) and hard-codes role = employee (no signup
-- privilege hole — even a forged API signup cannot inject a higher role).
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role_id)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      split_part(new.email, '@', 1)          -- fallback display name
    ),
    (select id from public.roles where name = 'employee')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============ updated_at ============

create or replace function public.set_updated_at()
returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

-- ============ Overdue flagging ============

-- Sets a transaction-local flag so the tasks pinning trigger knows this
-- status change is the system's, not a user's ('overdue' is system-only).
create or replace function public.flag_overdue_tasks()
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('meritly.system_update', 'true', true);
  update public.tasks
  set status = 'overdue'
  where deadline < now()
    and status in ('pending','in_progress')
    and deleted_at is null;          -- archived tasks are never flagged
  perform set_config('meritly.system_update', 'false', true);
end;
$$;

-- ============ Column-pinning triggers ============
-- RLS gates ROWS; these triggers gate COLUMNS (RLS cannot).

-- profiles: role_id and deleted_at are the crown jewels.
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  employee_role_id int := (select id from public.roles where name = 'employee');
  new_role_name text;
begin
  if auth.uid() is null then return new; end if;   -- direct SQL bypass

  if new.id is distinct from old.id then
    raise exception 'profile id cannot change';
  end if;

  -- role changes
  if new.role_id is distinct from old.role_id then
    select r.name into new_role_name from public.roles r where r.id = new.role_id;
    if new_role_name = 'admin' then
      -- single-admin invariant: admin is unassignable via the API, by anyone
      raise exception 'the admin role cannot be assigned';
    end if;
    if old.id = auth.uid() then
      raise exception 'you cannot change your own role';
    end if;
    if public.has_permission('user.manage_all') then
      null;                                        -- admin: any target but self
    elsif public.has_permission('user.promote')
          and old.role_id = employee_role_id then
      null;                                        -- HR: current employees only (one-way grant)
    else
      raise exception 'not allowed to change this user''s role';
    end if;
  end if;

  -- archive / restore
  if new.deleted_at is distinct from old.deleted_at then
    if old.id = auth.uid() then
      raise exception 'you cannot archive yourself';
    end if;
    if public.has_permission('user.manage_all') then
      null;                                        -- admin: anyone but self
    elsif public.has_permission('user.archive')
          and old.role_id = employee_role_id then
      null;                                        -- HR: employees only
    else
      raise exception 'not allowed to archive or restore this user';
    end if;
  end if;

  return new;
end;
$$;

create trigger protect_profile_columns
before update on public.profiles
for each row execute function public.protect_profile_columns();

-- tasks: status transitions are whitelisted; fields need task.update;
-- archiving needs task.archive; archived tasks are frozen.
create or replace function public.protect_task_columns()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- direct SQL bypass
  if coalesce(current_setting('meritly.system_update', true), '') = 'true' then
    return new;                                    -- flag_overdue_tasks()
  end if;

  -- archive/restore requires task.archive; otherwise archived = frozen
  if new.deleted_at is distinct from old.deleted_at then
    if not public.has_permission('task.archive') then
      raise exception 'not allowed to archive tasks';
    end if;
  elsif old.deleted_at is not null then
    raise exception 'archived tasks cannot be modified';
  end if;

  -- status transition whitelist (DESIGN.md §4)
  if new.status is distinct from old.status then
    if public.has_permission('submission.review')
       and old.status = 'submitted'
       and new.status in ('completed','needs_revision') then
      null;                                        -- reviewer verdict
    elsif old.assigned_to = auth.uid() and public.is_active()
       and ((old.status = 'pending' and new.status = 'in_progress')
         or (old.status in ('in_progress','needs_revision','overdue')
             and new.status = 'submitted')) then
      null;                                        -- owner: start / submit (late allowed)
    else
      raise exception 'status change % -> % is not allowed', old.status, new.status;
    end if;
  end if;

  -- every other column requires task.update
  if (new.title, new.description, new.assigned_to, new.assigned_by,
      new.priority, new.deadline)
     is distinct from
     (old.title, old.description, old.assigned_to, old.assigned_by,
      old.priority, old.deadline) then
    if not public.has_permission('task.update') then
      raise exception 'not allowed to edit task fields';
    end if;
  end if;

  return new;
end;
$$;

create trigger protect_task_columns
before update on public.tasks
for each row execute function public.protect_task_columns();

-- submissions: content is immutable evidence; reviewers may only write
-- hr_feedback / reviewed_at.
create or replace function public.protect_submission_columns()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- direct SQL bypass

  if (new.id, new.task_id, new.employee_id, new.note, new.file_url, new.submitted_at)
     is distinct from
     (old.id, old.task_id, old.employee_id, old.note, old.file_url, old.submitted_at) then
    raise exception 'submission content is immutable';
  end if;

  if not public.has_permission('submission.review') then
    raise exception 'only reviewers may update submissions';
  end if;

  return new;
end;
$$;

create trigger protect_submission_columns
before update on public.submissions
for each row execute function public.protect_submission_columns();
