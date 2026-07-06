-- Migration 1: tables, indexes, RBAC seed data (DESIGN.md v1.7 §1–§2)

-- ============ RBAC tables ============

create table public.roles (
  id serial primary key,
  name text not null unique
);

create table public.permissions (
  id serial primary key,
  key text not null unique
);

-- Junction table: one row = one permission key on one role's keyring.
-- CASCADE here is the deliberate exception: these rows are configuration,
-- not evidence — deleting a role should sweep its grants.
create table public.role_permissions (
  role_id int not null references public.roles(id) on delete cascade,
  permission_id int not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- ============ Domain tables ============

-- Extends auth.users 1-to-1 (same id). RESTRICT: a login cannot be
-- hard-deleted while its profile exists (soft delete is the only exit).
create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null,
  role_id int not null references public.roles(id) on delete restrict,
  deleted_at timestamptz,          -- NULL = active; timestamp = archived
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_to uuid not null references public.profiles(id) on delete restrict,
  assigned_by uuid not null references public.profiles(id) on delete restrict,
  priority text not null default 'medium'
    check (priority in ('high','medium','low')),
  deadline timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','in_progress','submitted','completed','needs_revision','overdue')),
  deleted_at timestamptz,          -- soft delete (archive)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_assigned_to_idx on public.tasks (assigned_to);
create index tasks_status_idx on public.tasks (status);

-- Append-mostly evidence: content columns are frozen after insert
-- (pinning trigger in migration 2); only reviewer feedback may change.
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  employee_id uuid not null references public.profiles(id) on delete restrict,
  note text not null,
  file_url text,
  submitted_at timestamptz not null default now(),
  hr_feedback text,
  reviewed_at timestamptz
);

create index submissions_task_id_idx on public.submissions (task_id);
create index submissions_employee_id_idx on public.submissions (employee_id);

-- Append-only: no UPDATE/DELETE policies will exist. To revise a rating,
-- insert a new row for the same period; the app reads the latest.
create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete restrict,
  rated_by uuid not null references public.profiles(id) on delete restrict,
  score int not null check (score between 1 and 5),
  ai_suggested_score int check (ai_suggested_score between 1 and 5),
  comment text,
  ai_summary text,
  period text not null,            -- e.g. '2026-07'
  created_at timestamptz not null default now()
);

create index ratings_employee_id_idx on public.ratings (employee_id);

-- ============ Seed data ============

insert into public.roles (name) values ('admin'), ('hr'), ('employee');

insert into public.permissions (key) values
  ('submission.create'),
  ('task.create'), ('task.update'), ('task.archive'), ('task.view_all'),
  ('submission.review'),
  ('rating.create'), ('rating.view_all'),
  ('stats.view_all'),
  ('user.promote'), ('user.archive'), ('user.manage_all'),
  ('role.manage');

-- employee keyring
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.name = 'employee' and p.key in ('submission.create');

-- hr keyring
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.name = 'hr' and p.key in (
  'submission.create',
  'task.create','task.update','task.archive','task.view_all',
  'submission.review',
  'rating.create','rating.view_all',
  'stats.view_all',
  'user.promote','user.archive'
);

-- admin keyring: every key
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.name = 'admin';
