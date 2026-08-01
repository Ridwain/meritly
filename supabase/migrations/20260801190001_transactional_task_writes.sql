-- Meritly MCP v1: one transactional write path shared by the web app and MCP.
--
-- These functions are SECURITY INVOKER: public task/submission RLS and the
-- existing protection triggers still evaluate as the signed-in user.

-- ---------------------------------------------------------------------------
-- File reference validation used by create/update/submit transactions
-- ---------------------------------------------------------------------------

create function private.assert_owned_storage_object(
  p_bucket text,
  p_path text,
  p_actor uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor is distinct from auth.uid() then
    raise exception 'file ownership must match the signed-in user';
  end if;
  if p_bucket not in ('task-attachments', 'submissions') then
    raise exception 'unsupported file bucket';
  end if;
  if p_path is null
     or char_length(p_path) > 1024
     or p_path like '/%'
     or p_path ~ '(^|/)\.\.(/|$)'
     or split_part(p_path, '/', 1) <> p_actor::text then
    raise exception 'invalid file path';
  end if;
  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = p_bucket
      and o.name = p_path
  ) then
    raise exception 'uploaded file not found';
  end if;
end;
$$;

revoke execute on function private.assert_owned_storage_object(
  text, text, uuid
) from public, anon;
grant execute on function private.assert_owned_storage_object(
  text, text, uuid
) to authenticated;

-- ---------------------------------------------------------------------------
-- Create task
-- ---------------------------------------------------------------------------

create function public.create_task_transaction(
  p_request_id uuid,
  p_payload jsonb,
  p_connection_hash text default null,
  p_approval_token uuid default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  op record;
  actor_id uuid := auth.uid();
  clean_title text;
  clean_description text;
  assignee_id uuid;
  task_priority text;
  task_deadline timestamptz;
  new_attachment_path text;
  new_attachment_name text;
  new_task public.tasks%rowtype;
  result jsonb;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or p_payload - array[
       'title', 'description', 'assigned_to', 'priority', 'deadline',
       'attachment_path', 'attachment_name'
     ]::text[] <> '{}'::jsonb
     or not (p_payload ?& array[
       'title', 'assigned_to', 'priority', 'deadline'
     ]::text[]) then
    raise exception 'invalid create_task payload';
  end if;

  clean_title := btrim(coalesce(p_payload->>'title', ''));
  clean_description := nullif(btrim(coalesce(p_payload->>'description', '')), '');
  assignee_id := nullif(p_payload->>'assigned_to', '')::uuid;
  task_priority := p_payload->>'priority';
  task_deadline := (p_payload->>'deadline')::timestamptz;
  new_attachment_path := nullif(p_payload->>'attachment_path', '');
  new_attachment_name := nullif(
    btrim(coalesce(p_payload->>'attachment_name', '')),
    ''
  );

  if char_length(clean_title) not between 1 and 200 then
    raise exception 'title must be between 1 and 200 characters';
  end if;
  if char_length(coalesce(clean_description, '')) > 5000 then
    raise exception 'description is too long';
  end if;
  if assignee_id is null then
    raise exception 'assignee is required';
  end if;
  if task_priority not in ('high', 'medium', 'low') then
    raise exception 'invalid priority';
  end if;
  if task_deadline is null or task_deadline <= now() then
    raise exception 'deadline must be in the future';
  end if;
  if (new_attachment_path is null) <> (new_attachment_name is null) then
    raise exception 'attachment path and name must be provided together';
  end if;
  if new_attachment_name is not null and (
    char_length(new_attachment_name) > 180
    or new_attachment_name ~ '[[:cntrl:]]'
  ) then
    raise exception 'invalid attachment name';
  end if;

  select * into op
  from private.begin_operation(
    'create_task',
    p_request_id,
    p_payload,
    p_connection_hash,
    p_approval_token
  );

  if op.duplicate_request then
    return op.previous_result;
  end if;

  if new_attachment_path is not null then
    perform private.assert_owned_storage_object(
      'task-attachments',
      new_attachment_path,
      actor_id
    );
  end if;

  insert into public.tasks (
    title,
    description,
    assigned_to,
    assigned_by,
    priority,
    deadline,
    status,
    attachment_path,
    attachment_name
  ) values (
    clean_title,
    clean_description,
    assignee_id,
    actor_id,
    task_priority,
    task_deadline,
    'pending',
    new_attachment_path,
    new_attachment_name
  )
  returning * into new_task;

  result := jsonb_build_object(
    'task_id', new_task.id,
    'status', new_task.status,
    'duplicate_request', false
  );

  return private.complete_operation(op.operation_id, new_task.id, result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Update and archive task
-- ---------------------------------------------------------------------------

create function public.update_task_transaction(
  p_request_id uuid,
  p_payload jsonb,
  p_connection_hash text default null,
  p_approval_token uuid default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  op record;
  actor_id uuid := auth.uid();
  target_task_id uuid;
  clean_title text;
  clean_description text;
  assignee_id uuid;
  task_priority text;
  task_deadline timestamptz;
  has_attachment_change boolean;
  new_attachment_path text;
  new_attachment_name text;
  current_task public.tasks%rowtype;
  updated_task public.tasks%rowtype;
  result jsonb;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or p_payload - array[
       'task_id', 'title', 'description', 'assigned_to', 'priority', 'deadline',
       'attachment_path', 'attachment_name'
     ]::text[] <> '{}'::jsonb
     or not (p_payload ?& array[
       'task_id', 'title', 'assigned_to', 'priority', 'deadline'
     ]::text[])
     or ((p_payload ? 'attachment_path') <> (p_payload ? 'attachment_name')) then
    raise exception 'invalid update_task payload';
  end if;

  target_task_id := nullif(p_payload->>'task_id', '')::uuid;
  clean_title := btrim(coalesce(p_payload->>'title', ''));
  clean_description := nullif(btrim(coalesce(p_payload->>'description', '')), '');
  assignee_id := nullif(p_payload->>'assigned_to', '')::uuid;
  task_priority := p_payload->>'priority';
  task_deadline := (p_payload->>'deadline')::timestamptz;
  has_attachment_change := p_payload ? 'attachment_path';
  new_attachment_path := nullif(p_payload->>'attachment_path', '');
  new_attachment_name := nullif(
    btrim(coalesce(p_payload->>'attachment_name', '')),
    ''
  );

  if target_task_id is null then
    raise exception 'task id is required';
  end if;
  if char_length(clean_title) not between 1 and 200 then
    raise exception 'title must be between 1 and 200 characters';
  end if;
  if char_length(coalesce(clean_description, '')) > 5000 then
    raise exception 'description is too long';
  end if;
  if assignee_id is null then
    raise exception 'assignee is required';
  end if;
  if task_priority not in ('high', 'medium', 'low') then
    raise exception 'invalid priority';
  end if;
  if task_deadline is null then
    raise exception 'deadline is required';
  end if;
  if has_attachment_change and (
    (new_attachment_path is null) <> (new_attachment_name is null)
  ) then
    raise exception 'attachment path and name must be provided together';
  end if;
  if new_attachment_name is not null and (
    char_length(new_attachment_name) > 180
    or new_attachment_name ~ '[[:cntrl:]]'
  ) then
    raise exception 'invalid attachment name';
  end if;

  select * into op
  from private.begin_operation(
    'update_task',
    p_request_id,
    p_payload,
    p_connection_hash,
    p_approval_token
  );

  if op.duplicate_request then
    return op.previous_result;
  end if;

  select t.*
  into current_task
  from public.tasks t
  where t.id = target_task_id
  for update;

  if not found then
    raise exception 'task not found or inaccessible';
  end if;

  if has_attachment_change and new_attachment_path is not null
     and new_attachment_path is distinct from current_task.attachment_path then
    perform private.assert_owned_storage_object(
      'task-attachments',
      new_attachment_path,
      actor_id
    );
  end if;

  update public.tasks t
  set
    title = clean_title,
    description = clean_description,
    assigned_to = assignee_id,
    priority = task_priority,
    deadline = task_deadline,
    attachment_path = case
      when has_attachment_change then new_attachment_path
      else t.attachment_path
    end,
    attachment_name = case
      when has_attachment_change then new_attachment_name
      else t.attachment_name
    end
  where t.id = target_task_id
  returning t.* into updated_task;

  result := jsonb_build_object(
    'task_id', updated_task.id,
    'status', updated_task.status,
    'duplicate_request', false
  );

  return private.complete_operation(op.operation_id, updated_task.id, result);
end;
$$;

create function public.archive_task_transaction(
  p_request_id uuid,
  p_payload jsonb,
  p_connection_hash text default null,
  p_approval_token uuid default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  op record;
  target_task_id uuid;
  current_task public.tasks%rowtype;
  result jsonb;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or p_payload - array['task_id']::text[] <> '{}'::jsonb
     or not (p_payload ? 'task_id') then
    raise exception 'invalid archive_task payload';
  end if;

  target_task_id := nullif(p_payload->>'task_id', '')::uuid;
  if target_task_id is null then
    raise exception 'task id is required';
  end if;

  select * into op
  from private.begin_operation(
    'archive_task',
    p_request_id,
    p_payload,
    p_connection_hash,
    p_approval_token
  );

  if op.duplicate_request then
    return op.previous_result;
  end if;

  select t.*
  into current_task
  from public.tasks t
  where t.id = target_task_id
  for update;

  if not found then
    raise exception 'task not found or inaccessible';
  end if;
  if current_task.deleted_at is not null then
    raise exception 'task is already archived';
  end if;

  update public.tasks
  set deleted_at = now()
  where id = target_task_id;

  result := jsonb_build_object(
    'task_id', target_task_id,
    'archived', true,
    'duplicate_request', false
  );

  return private.complete_operation(op.operation_id, target_task_id, result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Start and submit work
-- ---------------------------------------------------------------------------

create function public.start_task_transaction(
  p_request_id uuid,
  p_payload jsonb,
  p_connection_hash text default null,
  p_approval_token uuid default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  op record;
  target_task_id uuid;
  current_task public.tasks%rowtype;
  result jsonb;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or p_payload - array['task_id']::text[] <> '{}'::jsonb
     or not (p_payload ? 'task_id') then
    raise exception 'invalid start_task payload';
  end if;

  target_task_id := nullif(p_payload->>'task_id', '')::uuid;
  if target_task_id is null then
    raise exception 'task id is required';
  end if;

  select * into op
  from private.begin_operation(
    'start_task',
    p_request_id,
    p_payload,
    p_connection_hash,
    p_approval_token
  );

  if op.duplicate_request then
    return op.previous_result;
  end if;

  select t.*
  into current_task
  from public.tasks t
  where t.id = target_task_id
  for update;

  if not found then
    raise exception 'task not found or inaccessible';
  end if;
  if current_task.status <> 'pending' or current_task.deleted_at is not null then
    raise exception 'task is not startable';
  end if;

  update public.tasks
  set status = 'in_progress'
  where id = target_task_id;

  result := jsonb_build_object(
    'task_id', target_task_id,
    'status', 'in_progress',
    'duplicate_request', false
  );

  return private.complete_operation(op.operation_id, target_task_id, result);
end;
$$;

create function public.submit_work_transaction(
  p_request_id uuid,
  p_payload jsonb,
  p_connection_hash text default null,
  p_approval_token uuid default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  op record;
  actor_id uuid := auth.uid();
  target_task_id uuid;
  clean_note text;
  file_path text;
  current_task public.tasks%rowtype;
  new_submission public.submissions%rowtype;
  result jsonb;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or p_payload - array['task_id', 'note', 'file_path']::text[] <> '{}'::jsonb
     or not (p_payload ?& array['task_id', 'note']::text[]) then
    raise exception 'invalid submit_work payload';
  end if;

  target_task_id := nullif(p_payload->>'task_id', '')::uuid;
  clean_note := btrim(coalesce(p_payload->>'note', ''));
  file_path := nullif(p_payload->>'file_path', '');

  if target_task_id is null then
    raise exception 'task id is required';
  end if;
  if char_length(clean_note) not between 1 and 5000 then
    raise exception 'work note must be between 1 and 5000 characters';
  end if;

  select * into op
  from private.begin_operation(
    'submit_work',
    p_request_id,
    p_payload,
    p_connection_hash,
    p_approval_token
  );

  if op.duplicate_request then
    return op.previous_result;
  end if;

  select t.*
  into current_task
  from public.tasks t
  where t.id = target_task_id
  for update;

  if not found then
    raise exception 'task not found or inaccessible';
  end if;
  if current_task.assigned_to <> actor_id
     or current_task.deleted_at is not null
     or current_task.status not in (
       'in_progress', 'needs_revision', 'overdue'
     ) then
    raise exception 'task is not submittable';
  end if;

  if file_path is not null then
    perform private.assert_owned_storage_object(
      'submissions',
      file_path,
      actor_id
    );
  end if;

  insert into public.submissions (
    task_id,
    employee_id,
    note,
    file_path
  ) values (
    target_task_id,
    actor_id,
    clean_note,
    file_path
  )
  returning * into new_submission;

  update public.tasks
  set status = 'submitted'
  where id = target_task_id;

  result := jsonb_build_object(
    'task_id', target_task_id,
    'submission_id', new_submission.id,
    'status', 'submitted',
    'duplicate_request', false
  );

  return private.complete_operation(op.operation_id, target_task_id, result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Review submission and task in one transaction
-- ---------------------------------------------------------------------------

create function public.review_submission_transaction(
  p_request_id uuid,
  p_payload jsonb,
  p_connection_hash text default null,
  p_approval_token uuid default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  op record;
  target_task_id uuid;
  target_submission_id uuid;
  decision text;
  clean_feedback text;
  current_task public.tasks%rowtype;
  current_submission public.submissions%rowtype;
  latest_submission_id uuid;
  result jsonb;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or p_payload - array[
       'task_id', 'submission_id', 'decision', 'feedback'
     ]::text[] <> '{}'::jsonb
     or not (p_payload ?& array[
       'task_id', 'submission_id', 'decision'
     ]::text[]) then
    raise exception 'invalid review_submission payload';
  end if;

  target_task_id := nullif(p_payload->>'task_id', '')::uuid;
  target_submission_id := nullif(p_payload->>'submission_id', '')::uuid;
  decision := p_payload->>'decision';
  clean_feedback := nullif(btrim(coalesce(p_payload->>'feedback', '')), '');

  if target_task_id is null or target_submission_id is null then
    raise exception 'task and submission ids are required';
  end if;
  if decision not in ('completed', 'needs_revision') then
    raise exception 'invalid review decision';
  end if;
  if char_length(coalesce(clean_feedback, '')) > 5000 then
    raise exception 'feedback is too long';
  end if;

  select * into op
  from private.begin_operation(
    'review_submission',
    p_request_id,
    p_payload,
    p_connection_hash,
    p_approval_token
  );

  if op.duplicate_request then
    return op.previous_result;
  end if;

  -- Every task/submission transaction locks the task first, preventing a
  -- reviewer and employee from advancing the same workflow concurrently.
  select t.*
  into current_task
  from public.tasks t
  where t.id = target_task_id
  for update;

  if not found then
    raise exception 'task not found or inaccessible';
  end if;
  if current_task.status <> 'submitted'
     or current_task.deleted_at is not null then
    raise exception 'task is not awaiting review';
  end if;

  select s.*
  into current_submission
  from public.submissions s
  where s.id = target_submission_id
    and s.task_id = target_task_id
  for update;

  if not found then
    raise exception 'submission not found or inaccessible';
  end if;

  select s.id
  into latest_submission_id
  from public.submissions s
  where s.task_id = target_task_id
  order by s.submitted_at desc, s.id desc
  limit 1;

  if latest_submission_id <> target_submission_id then
    raise exception 'only the latest submission can be reviewed';
  end if;

  update public.submissions
  set
    hr_feedback = clean_feedback,
    reviewed_at = now()
  where id = target_submission_id;

  update public.tasks
  set status = decision
  where id = target_task_id;

  result := jsonb_build_object(
    'task_id', target_task_id,
    'submission_id', target_submission_id,
    'status', decision,
    'duplicate_request', false
  );

  return private.complete_operation(op.operation_id, target_task_id, result);
end;
$$;

-- Authenticated clients can call only the public transaction entry points.
revoke execute on function public.create_task_transaction(
  uuid, jsonb, text, uuid
) from public, anon;
revoke execute on function public.update_task_transaction(
  uuid, jsonb, text, uuid
) from public, anon;
revoke execute on function public.archive_task_transaction(
  uuid, jsonb, text, uuid
) from public, anon;
revoke execute on function public.start_task_transaction(
  uuid, jsonb, text, uuid
) from public, anon;
revoke execute on function public.submit_work_transaction(
  uuid, jsonb, text, uuid
) from public, anon;
revoke execute on function public.review_submission_transaction(
  uuid, jsonb, text, uuid
) from public, anon;

grant execute on function public.create_task_transaction(
  uuid, jsonb, text, uuid
) to authenticated;
grant execute on function public.update_task_transaction(
  uuid, jsonb, text, uuid
) to authenticated;
grant execute on function public.archive_task_transaction(
  uuid, jsonb, text, uuid
) to authenticated;
grant execute on function public.start_task_transaction(
  uuid, jsonb, text, uuid
) to authenticated;
grant execute on function public.submit_work_transaction(
  uuid, jsonb, text, uuid
) to authenticated;
grant execute on function public.review_submission_transaction(
  uuid, jsonb, text, uuid
) to authenticated;

-- assigned_by is authorship evidence. Managers may reassign work, but neither
-- the web client nor MCP may rewrite who originally created the task.
create or replace function public.protect_task_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return new; end if;
  if coalesce(current_setting('meritly.system_update', true), '') = 'true' then
    return new;
  end if;

  if new.assigned_by is distinct from old.assigned_by then
    raise exception 'task authorship cannot change';
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
    new.priority,
    new.deadline,
    new.attachment_url,
    new.attachment_path,
    new.attachment_name
  ) is distinct from (
    old.title,
    old.description,
    old.assigned_to,
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
  from public, anon, authenticated;
