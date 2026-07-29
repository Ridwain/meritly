-- Feature 13: prepare private work files without breaking the deployed app.
--
-- The buckets remain public in this migration. The app first switches from
-- saved public URLs to canonical object paths and RLS-protected downloads.
-- A later migration flips both buckets to private after that app is deployed.

alter table public.tasks
  add column attachment_path text;

alter table public.submissions
  add column file_path text;

-- Old rows store complete public URLs. Keep those columns temporarily, but
-- derive the canonical object path that Storage policies can compare exactly.
update public.tasks
set attachment_path = split_part(
  split_part(attachment_url, '/object/public/task-attachments/', 2),
  '?',
  1
)
where attachment_url is not null;

update public.submissions
set file_path = split_part(
  split_part(file_url, '/object/public/submissions/', 2),
  '?',
  1
)
where file_url is not null;

do $$
begin
  if exists (
    select 1
    from public.tasks
    where attachment_url is not null
      and coalesce(attachment_path, '') = ''
  ) then
    raise exception 'Some task attachment URLs could not be converted to paths';
  end if;

  if exists (
    select 1
    from public.submissions
    where file_url is not null
      and coalesce(file_path, '') = ''
  ) then
    raise exception 'Some submission URLs could not be converted to paths';
  end if;

  if exists (
    select 1
    from public.tasks t
    where t.attachment_path is not null
      and not exists (
        select 1
        from storage.objects o
        where o.bucket_id = 'task-attachments'
          and o.name = t.attachment_path
      )
  ) then
    raise exception 'A task attachment path has no matching Storage object';
  end if;

  if exists (
    select 1
    from public.submissions s
    where s.file_path is not null
      and not exists (
        select 1
        from storage.objects o
        where o.bucket_id = 'submissions'
          and o.name = s.file_path
      )
  ) then
    raise exception 'A submission file path has no matching Storage object';
  end if;
end;
$$;

create index tasks_attachment_path_idx
  on public.tasks (attachment_path)
  where attachment_path is not null;

create index submissions_file_path_idx
  on public.submissions (file_path)
  where file_path is not null;

-- Preserve Feature 11's permission checks and protect the new canonical path
-- exactly like the old URL/name attachment fields.
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
    new.attachment_path,
    new.attachment_name
  ) is distinct from (
    old.title,
    old.description,
    old.assigned_to,
    old.assigned_by,
    old.priority,
    old.deadline,
    old.attachment_url,
    old.attachment_path,
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

-- Submission evidence is immutable, including its new Storage object path.
create or replace function public.protect_submission_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if (
    new.id,
    new.task_id,
    new.employee_id,
    new.note,
    new.file_url,
    new.file_path,
    new.submitted_at
  ) is distinct from (
    old.id,
    old.task_id,
    old.employee_id,
    old.note,
    old.file_url,
    old.file_path,
    old.submitted_at
  ) then
    raise exception 'submission content is immutable';
  end if;

  if not public.has_permission('submission.review') then
    raise exception 'only reviewers may update submissions';
  end if;

  return new;
end;
$$;

revoke execute on function public.protect_submission_columns()
  from anon, authenticated, public;

-- A Storage row is readable only if the caller can also read its parent
-- database row. The new department RLS policies therefore apply to files too.
create policy "submission_files_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'submissions'
  and exists (
    select 1
    from public.submissions s
    where s.file_path = storage.objects.name
  )
);

create policy "task_attachment_files_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'task-attachments'
  and exists (
    select 1
    from public.tasks t
    where t.attachment_path = storage.objects.name
  )
);
