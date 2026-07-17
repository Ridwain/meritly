-- Migration 10: tasks may only be assigned to employees who ACCEPTED their
-- invite (set a password). Invited-but-pending people were appearing in the
-- assignee dropdown and were assignable at the DB level.

-- Helper: active employee who has accepted (password set). SECURITY DEFINER
-- because acceptance lives in auth.users, which app roles can't read.
create or replace function public.is_assignable_employee(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    join auth.users u on u.id = p.id
    where p.id = target
      and p.deleted_at is null
      and r.name = 'employee'
      and u.encrypted_password is not null
      and u.encrypted_password <> ''
  );
$$;
revoke execute on function public.is_assignable_employee(uuid) from anon, public;
grant execute on function public.is_assignable_employee(uuid) to authenticated;

-- Dropdown source for the task form, gated by task.create.
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
    join auth.users u on u.id = p.id
    where p.deleted_at is null
      and r.name = 'employee'
      and u.encrypted_password is not null
      and u.encrypted_password <> ''
    order by p.full_name;
end;
$$;
revoke execute on function public.assignable_employees() from anon, public;
grant execute on function public.assignable_employees() to authenticated;

-- Tighten the INSERT policy: assignee must be an accepted, active employee.
drop policy "tasks_insert" on public.tasks;
create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check (
    public.has_permission('task.create')
    and assigned_by = auth.uid()
    and status = 'pending'
    and deleted_at is null
    and public.is_assignable_employee(assigned_to)
  );

-- Close the same hole on the EDIT path: reassigning a task must also target
-- an accepted, active employee. (Re-create the pinning trigger with the check.)
create or replace function public.protect_task_columns()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if coalesce(current_setting('meritly.system_update', true), '') = 'true' then
    return new;
  end if;

  if new.deleted_at is distinct from old.deleted_at then
    if not public.has_permission('task.archive') then
      raise exception 'not allowed to archive tasks';
    end if;
  elsif old.deleted_at is not null then
    raise exception 'archived tasks cannot be modified';
  end if;

  if new.status is distinct from old.status then
    if public.has_permission('submission.review')
       and old.status = 'submitted'
       and new.status in ('completed','needs_revision') then
      null;
    elsif old.assigned_to = auth.uid() and public.is_active()
       and ((old.status = 'pending' and new.status = 'in_progress')
         or (old.status in ('in_progress','needs_revision','overdue')
             and new.status = 'submitted')) then
      null;
    else
      raise exception 'status change % -> % is not allowed', old.status, new.status;
    end if;
  end if;

  -- Reassignment must target an accepted, active employee.
  if new.assigned_to is distinct from old.assigned_to
     and not public.is_assignable_employee(new.assigned_to) then
    raise exception 'assignee must be an active employee who accepted their invite';
  end if;

  if (new.title, new.description, new.assigned_to, new.assigned_by,
      new.priority, new.deadline, new.attachment_url, new.attachment_name)
     is distinct from
     (old.title, old.description, old.assigned_to, old.assigned_by,
      old.priority, old.deadline, old.attachment_url, old.attachment_name) then
    if not public.has_permission('task.update') then
      raise exception 'not allowed to edit task fields';
    end if;
  end if;

  return new;
end;
$$;
