-- Migration 3: Row Level Security + storage (DESIGN.md v1.7 §6–§7)
--
-- Deny-by-default: enabling RLS with no policy = nobody gets in.
-- NOTE the deliberate absences: no DELETE policy exists on any domain
-- table (hard deletion via the API is impossible — security by omission),
-- and no UPDATE policy exists on ratings (append-only).

alter table public.profiles         enable row level security;
alter table public.tasks            enable row level security;
alter table public.submissions      enable row level security;
alter table public.ratings          enable row level security;
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;

-- ============ RBAC tables ============
-- Everyone may read (the app shows role names; permission structure is
-- not a secret). Writes need role.manage (reserved for stretch Feature 11).

create policy "roles_select" on public.roles
  for select to authenticated using (true);
create policy "permissions_select" on public.permissions
  for select to authenticated using (true);
create policy "role_permissions_select" on public.role_permissions
  for select to authenticated using (true);

create policy "roles_write" on public.roles
  for all to authenticated
  using (public.has_permission('role.manage'))
  with check (public.has_permission('role.manage'));
create policy "permissions_write" on public.permissions
  for all to authenticated
  using (public.has_permission('role.manage'))
  with check (public.has_permission('role.manage'));
create policy "role_permissions_write" on public.role_permissions
  for all to authenticated
  using (public.has_permission('role.manage'))
  with check (public.has_permission('role.manage'));

-- ============ profiles ============

create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

-- Own row (active users only). The pinning trigger stops role_id /
-- deleted_at changes, so this effectively means "edit your own name".
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid() and deleted_at is null)
  with check (id = auth.uid());

-- Management: admin (user.manage_all) may touch anyone but self;
-- HR (user.promote / user.archive) may touch current employees only.
-- Fine print (which columns, which new roles) lives in the trigger.
create policy "profiles_update_manage" on public.profiles
  for update to authenticated
  using (
    id <> auth.uid()
    and (
      public.has_permission('user.manage_all')
      or (
        (public.has_permission('user.promote') or public.has_permission('user.archive'))
        and role_id = (select id from public.roles where name = 'employee')
      )
    )
  )
  with check (true);

-- INSERT: none (the signup trigger runs as definer and bypasses RLS).
-- DELETE: none, ever.

-- ============ tasks ============

create policy "tasks_select" on public.tasks
  for select to authenticated
  using (
    (assigned_to = auth.uid() and public.is_active())
    or public.has_permission('task.view_all')
  );

-- No forged authorship (assigned_by must be the caller), no pre-completed
-- tasks, and the assignee must be an ACTIVE EMPLOYEE.
create policy "tasks_insert" on public.tasks
  for insert to authenticated
  with check (
    public.has_permission('task.create')
    and assigned_by = auth.uid()
    and status = 'pending'
    and deleted_at is null
    and exists (
      select 1 from public.profiles p
      where p.id = assigned_to
        and p.deleted_at is null
        and p.role_id = (select id from public.roles where name = 'employee')
    )
  );

-- Owner updates (Start / submit) — the trigger whitelists the transitions.
create policy "tasks_update_own" on public.tasks
  for update to authenticated
  using (assigned_to = auth.uid() and public.is_active() and deleted_at is null)
  with check (assigned_to = auth.uid());

-- Manager updates (edit fields / review verdicts / archive) — trigger
-- enforces the column-level detail.
create policy "tasks_update_manage" on public.tasks
  for update to authenticated
  using (
    public.has_permission('task.update')
    or public.has_permission('task.archive')
    or public.has_permission('submission.review')
  )
  with check (true);

-- ============ submissions ============

create policy "submissions_select" on public.submissions
  for select to authenticated
  using (
    (employee_id = auth.uid() and public.is_active())
    or public.has_permission('submission.review')
  );

-- Only for your own task, and only while it is submittable.
-- 'overdue' stays submittable: late work must remain recordable —
-- that is exactly what the "late" statistic measures.
create policy "submissions_insert" on public.submissions
  for insert to authenticated
  with check (
    public.has_permission('submission.create')
    and employee_id = auth.uid()
    and exists (
      select 1 from public.tasks t
      where t.id = task_id
        and t.assigned_to = auth.uid()
        and t.deleted_at is null
        and t.status in ('in_progress','needs_revision','overdue')
    )
  );

-- Reviewers only; the trigger freezes everything except feedback columns.
create policy "submissions_update_review" on public.submissions
  for update to authenticated
  using (public.has_permission('submission.review'))
  with check (public.has_permission('submission.review'));

-- ============ ratings ============

create policy "ratings_select" on public.ratings
  for select to authenticated
  using (
    (employee_id = auth.uid() and public.is_active())
    or public.has_permission('rating.view_all')
  );

create policy "ratings_insert" on public.ratings
  for insert to authenticated
  with check (
    public.has_permission('rating.create')
    and rated_by = auth.uid()
  );

-- UPDATE: none (append-only — revisions are new rows, latest per period wins).
-- DELETE: none.

-- ============ storage ============

-- Public bucket (documented trade-off: URL-holders can download; the demo
-- accepts this, production would use a private bucket + signed URLs).
-- 10 MB cap, document/image/archive types only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'submissions', 'submissions', true, 10485760,
  array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'text/plain',
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
);

-- INSERT only, active users only, and ONLY into your own folder
-- (first path segment must equal your user id).
-- No UPDATE/DELETE policies -> uploaded files are immutable evidence.
create policy "submissions_upload_own_folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'submissions'
    and public.is_active()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
