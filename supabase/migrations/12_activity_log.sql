-- Migration 12: activity_log (Feature 9 — performance dashboard)
--
-- Why a new table at all? tasks.status only holds the CURRENT state — every
-- previous state is overwritten. To draw a trend over time we need history,
-- so this table appends one row every time a task is created or changes
-- status. Nothing in the app writes here directly; only the trigger below
-- does (SECURITY DEFINER, same bypass pattern as handle_new_user() in
-- migration 2 — no INSERT policy exists, and none is needed).

create table public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete restrict,
  employee_id uuid not null references public.profiles(id) on delete restrict,
  event       text not null check (
                event = any (array['pending','in_progress','submitted',
                                    'completed','needs_revision','overdue'])
              ),
  created_at  timestamptz not null default now()
);

create index activity_log_employee_id_idx on public.activity_log (employee_id);
create index activity_log_task_id_idx on public.activity_log (task_id);

-- ============ RLS ============
-- Read-only, same "own row OR stats.view_all" shape as ratings_select.
-- No INSERT/UPDATE/DELETE policy for anyone — see comment above.

alter table public.activity_log enable row level security;

create policy "activity_log_select" on public.activity_log
  for select to authenticated
  using (
    (employee_id = auth.uid() and public.is_active())
    or public.has_permission('stats.view_all')
  );

-- ============ Trigger: log on insert + on status change ============
-- event reuses the tasks.status vocabulary directly (no separate mapping
-- table) — a task's very first event is always 'pending', matching the
-- tasks_insert policy's hard-coded starting status.

create or replace function public.log_task_activity()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (task_id, employee_id, event, created_at)
    values (new.id, new.assigned_to, new.status, new.created_at);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.activity_log (task_id, employee_id, event, created_at)
    values (new.id, new.assigned_to, new.status, now());
  end if;
  return new;
end;
$$;

create trigger tasks_log_activity
after insert or update on public.tasks
for each row execute function public.log_task_activity();

-- ============ Backfill ============
-- Approximate, like the accepted_at backfill in migration 11: we only ever
-- had the CURRENT status stored, so we can log the original 'pending'
-- assignment (from created_at) and, if the task has since moved on, one more
-- row for its current status (from updated_at). Any states it passed
-- through in between were never recorded and cannot be recovered.

insert into public.activity_log (task_id, employee_id, event, created_at)
select id, assigned_to, 'pending', created_at
from public.tasks
where deleted_at is null;

insert into public.activity_log (task_id, employee_id, event, created_at)
select id, assigned_to, status, updated_at
from public.tasks
where deleted_at is null and status <> 'pending';
