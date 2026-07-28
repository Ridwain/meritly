-- Feature 11 follow-up: task ownership grants visibility, not work actions.
-- Starting/submitting work requires the submission.create capability at every
-- write boundary, so custom roles cannot inherit employee behaviour implicitly.

drop policy "tasks_update_own" on public.tasks;
create policy "tasks_update_own" on public.tasks
  for update to authenticated
  using (
    assigned_to = (select auth.uid())
    and (select public.is_active())
    and (select public.has_permission('submission.create'))
    and deleted_at is null
  )
  with check (
    assigned_to = (select auth.uid())
    and (select public.has_permission('submission.create'))
  );

-- Keep the trigger as the column/status-level authority even if an RLS policy is
-- changed later. This body is based on the current migration-10 definition.
create or replace function public.protect_task_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
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
       and new.status in ('completed', 'needs_revision') then
      null;
    elsif public.has_permission('submission.create')
          and old.assigned_to = auth.uid()
          and public.is_active()
          and (
            (old.status = 'pending' and new.status = 'in_progress')
            or (
              old.status in ('in_progress', 'needs_revision', 'overdue')
              and new.status = 'submitted'
            )
          ) then
      null;
    else
      raise exception 'status change % -> % is not allowed', old.status, new.status;
    end if;
  end if;

  if new.assigned_to is distinct from old.assigned_to
     and not public.is_assignable_employee(new.assigned_to) then
    raise exception 'assignee must be an active worker who accepted their invite';
  end if;

  if (
    new.title,
    new.description,
    new.assigned_to,
    new.assigned_by,
    new.priority,
    new.deadline,
    new.attachment_url,
    new.attachment_name
  ) is distinct from (
    old.title,
    old.description,
    old.assigned_to,
    old.assigned_by,
    old.priority,
    old.deadline,
    old.attachment_url,
    old.attachment_name
  ) then
    if not public.has_permission('task.update') then
      raise exception 'not allowed to edit task fields';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_task_columns()
  from anon, authenticated, public;

-- Prevent permissionless users from uploading orphaned public files before the
-- submissions table rejects their insert.
drop policy "submissions_upload_own_folder" on storage.objects;
create policy "submissions_upload_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and (select public.is_active())
    and (select public.has_permission('submission.create'))
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
