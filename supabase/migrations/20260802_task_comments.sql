-- Migration: task_comments table
-- Adds a threaded comment system to tasks.
-- Both HR and the assigned employee can post; anyone with task access can read.

create table if not exists public.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete restrict,
  author_id   uuid not null references public.profiles(id) on delete restrict,
  body        text not null check (char_length(body) > 0 and char_length(body) <= 2000),
  -- ai_generated = true marks comments that were drafted by Gemini and then
  -- approved/sent by HR — visible to the employee as a normal comment but
  -- tagged so the UI can show an "AI assisted" badge.
  ai_generated boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Indexes
create index if not exists task_comments_task_id_idx on public.task_comments(task_id);
create index if not exists task_comments_author_id_idx on public.task_comments(author_id);

-- Row Level Security
alter table public.task_comments enable row level security;

-- SELECT: the task owner (employee) can read comments on their own tasks;
-- anyone with task.view_all (HR/admin) can read all comments.
create policy "task_comments_select" on public.task_comments
  for select
  using (
    -- Employee sees comments on their own tasks
    exists (
      select 1 from public.tasks t
      where t.id = task_comments.task_id
        and t.assigned_to = auth.uid()
        and t.deleted_at is null
    )
    or
    -- HR / admin see all
    has_permission('task.view_all')
  );

-- INSERT: employee can comment on their own active tasks;
-- HR/admin need task.view_all (they can always reach the thread).
create policy "task_comments_insert" on public.task_comments
  for insert
  with check (
    author_id = auth.uid()
    and is_active()
    and (
      -- Employee posting on their own task
      exists (
        select 1 from public.tasks t
        where t.id = task_comments.task_id
          and t.assigned_to = auth.uid()
          and t.deleted_at is null
      )
      or
      -- HR / admin posting anywhere
      has_permission('task.view_all')
    )
  );

-- No UPDATE or DELETE policies — comments are immutable once posted.
-- (Same philosophy as submissions: evidence integrity.)
