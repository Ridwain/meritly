-- Migration 9: optional file attachment on a task (HR attaches a brief/spec).

-- 1) Columns to hold the uploaded file's public URL + original filename.
alter table public.tasks add column attachment_url  text;
alter table public.tasks add column attachment_name text;

-- 2) Re-create the task column-pinning trigger to ALSO protect the attachment
--    columns. Without this, an employee could swap the attachment on their own
--    task via the tasks_update_own policy. Changing it now needs task.update.
create or replace function public.protect_task_columns()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;               -- direct SQL bypass
  if coalesce(current_setting('meritly.system_update', true), '') = 'true' then
    return new;                                                 -- flag_overdue_tasks()
  end if;

  -- archive/restore requires task.archive; otherwise archived = frozen
  if new.deleted_at is distinct from old.deleted_at then
    if not public.has_permission('task.archive') then
      raise exception 'not allowed to archive tasks';
    end if;
  elsif old.deleted_at is not null then
    raise exception 'archived tasks cannot be modified';
  end if;

  -- status transition whitelist
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

  -- editable definition fields (now incl. attachment) require task.update
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

-- 3) A dedicated public bucket for task attachments (10 MB, docs/images).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments', 'task-attachments', true, 10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png', 'image/jpeg', 'image/webp',
    'text/plain', 'application/zip'
  ]
);

-- 4) Upload policy: only active users who may create tasks, into their own
--    folder. No UPDATE/DELETE -> files are immutable. Public read via bucket.
create policy "task_attachments_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-attachments'
    and public.is_active()
    and public.has_permission('task.create')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
