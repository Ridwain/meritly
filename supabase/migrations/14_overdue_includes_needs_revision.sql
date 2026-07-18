-- Migration 14: include needs_revision in overdue flagging (Feature 8 fix)
--
-- flag_overdue_tasks() only ever flagged 'pending'/'in_progress' tasks as
-- overdue — a task sent back for revision (needs_revision) never got
-- flagged even after its deadline passed, since that status was missing
-- from the WHERE clause. needs_revision is really the same kind of
-- "waiting on the employee" state as pending/in_progress, so it belongs in
-- the same list. Safe to add: the status-transition whitelist in
-- protect_task_columns() already lets an employee resubmit from EITHER
-- needs_revision OR overdue, so flipping needs_revision -> overdue here
-- doesn't block resubmission.
create or replace function public.flag_overdue_tasks()
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('meritly.system_update', 'true', true);
  update public.tasks
  set status = 'overdue'
  where deadline < now()
    and status in ('pending','in_progress','needs_revision')
    and deleted_at is null;          -- archived tasks are never flagged
  perform set_config('meritly.system_update', 'false', true);
end;
$$;
