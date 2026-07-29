-- Feature 11 permission matrix.
--
-- The suite creates isolated fixtures, impersonates API users through JWT
-- claims, and rolls every change back. It is safe to run repeatedly.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select * from no_plan();

-- Stable fixture identifiers make the assertions readable. They never persist
-- because the outer transaction always rolls back.
create temporary table audit_ids (
  name text primary key,
  id uuid not null
);

insert into audit_ids (name, id) values
  ('actor',          'a0000000-0000-4000-8000-000000000001'),
  ('worker_one',     'a0000000-0000-4000-8000-000000000002'),
  ('worker_two',     'a0000000-0000-4000-8000-000000000003'),
  ('non_worker',     'a0000000-0000-4000-8000-000000000004'),
  ('archived_actor', 'a0000000-0000-4000-8000-000000000005'),
  ('own_task',       'b0000000-0000-4000-8000-000000000001'),
  ('worker_task',    'b0000000-0000-4000-8000-000000000002'),
  ('submitted_task', 'b0000000-0000-4000-8000-000000000003'),
  ('archive_task',   'b0000000-0000-4000-8000-000000000004'),
  ('submission',     'c0000000-0000-4000-8000-000000000001'),
  ('rating',         'd0000000-0000-4000-8000-000000000001');

create function pg_temp.audit_id(label text)
returns uuid
language sql
stable
as $$
  select id from pg_temp.audit_ids where name = label;
$$;

-- Change only the audit actor's keyring. SECURITY DEFINER lets the helper run
-- during an impersonated test without weakening any public application API.
create function pg_temp.set_audit_permissions(keys text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_role_id integer;
begin
  select id into audit_role_id
  from public.roles
  where name = 'audit_actor_role';

  delete from public.role_permissions
  where role_id = audit_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select audit_role_id, p.id
  from public.permissions p
  where p.key = any(keys);
end;
$$;

create function pg_temp.authenticate_as(target uuid)
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', target, 'role', 'authenticated')::text,
    true
  );
$$;

create function pg_temp.clear_auth()
returns void
language sql
as $$
  select set_config('request.jwt.claims', '{}', true);
$$;

-- ---------------------------------------------------------------------------
-- Fixture setup (postgres/direct SQL; application RLS is tested below).
-- ---------------------------------------------------------------------------

select pg_temp.clear_auth();

insert into public.roles (name, assignable_work, protected, hr_grantable) values
  ('audit_actor_role', true, false, false),
  ('audit_worker_role', true, false, false),
  ('audit_non_worker_role', false, false, false),
  ('audit_hr_target_role', false, false, true);

-- Feature 13 makes Auth provisioning token-only. These fixtures are database
-- test setup, so create Auth and profile rows explicitly instead of pretending
-- they came through the production invitation route.
alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  fixture.id,
  'authenticated',
  'authenticated',
  fixture.email,
  '',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', fixture.full_name),
  now(),
  now()
from (
  values
    (pg_temp.audit_id('actor'), 'rbac-actor@example.test', 'RBAC Actor'),
    (pg_temp.audit_id('worker_one'), 'rbac-worker-one@example.test', 'RBAC Worker One'),
    (pg_temp.audit_id('worker_two'), 'rbac-worker-two@example.test', 'RBAC Worker Two'),
    (pg_temp.audit_id('non_worker'), 'rbac-non-worker@example.test', 'RBAC Non Worker'),
    (pg_temp.audit_id('archived_actor'), 'rbac-archived@example.test', 'RBAC Archived')
) as fixture(id, email, full_name);

alter table auth.users enable trigger on_auth_user_created;

insert into public.profiles (id, full_name, role_id, department_id)
select
  fixture.id,
  fixture.full_name,
  (select id from public.roles where name = 'audit_worker_role'),
  (select id from public.departments where name = 'General')
from (
  values
    (pg_temp.audit_id('actor'), 'RBAC Actor'),
    (pg_temp.audit_id('worker_one'), 'RBAC Worker One'),
    (pg_temp.audit_id('worker_two'), 'RBAC Worker Two'),
    (pg_temp.audit_id('non_worker'), 'RBAC Non Worker'),
    (pg_temp.audit_id('archived_actor'), 'RBAC Archived')
) as fixture(id, full_name);

update public.profiles
set role_id = case id
    when pg_temp.audit_id('actor')
      then (select id from public.roles where name = 'audit_actor_role')
    when pg_temp.audit_id('worker_one')
      then (select id from public.roles where name = 'audit_worker_role')
    when pg_temp.audit_id('worker_two')
      then (select id from public.roles where name = 'audit_worker_role')
    when pg_temp.audit_id('non_worker')
      then (select id from public.roles where name = 'audit_non_worker_role')
    when pg_temp.audit_id('archived_actor')
      then (select id from public.roles where name = 'audit_actor_role')
  end,
  accepted_at = now()
where id in (
  pg_temp.audit_id('actor'),
  pg_temp.audit_id('worker_one'),
  pg_temp.audit_id('worker_two'),
  pg_temp.audit_id('non_worker'),
  pg_temp.audit_id('archived_actor')
);

update public.profiles
set deleted_at = now()
where id = pg_temp.audit_id('archived_actor');

insert into public.tasks (
  id, title, description, assigned_to, assigned_by,
  priority, deadline, status
) values
  (
    pg_temp.audit_id('own_task'),
    'RBAC own task',
    'Fixture',
    pg_temp.audit_id('actor'),
    pg_temp.audit_id('non_worker'),
    'medium',
    now() + interval '7 days',
    'pending'
  ),
  (
    pg_temp.audit_id('worker_task'),
    'RBAC worker task',
    'Fixture',
    pg_temp.audit_id('worker_one'),
    pg_temp.audit_id('non_worker'),
    'medium',
    now() + interval '7 days',
    'pending'
  ),
  (
    pg_temp.audit_id('submitted_task'),
    'RBAC submitted task',
    'Fixture',
    pg_temp.audit_id('worker_two'),
    pg_temp.audit_id('non_worker'),
    'high',
    now() + interval '7 days',
    'submitted'
  ),
  (
    pg_temp.audit_id('archive_task'),
    'RBAC archive task',
    'Fixture',
    pg_temp.audit_id('worker_one'),
    pg_temp.audit_id('non_worker'),
    'low',
    now() + interval '7 days',
    'pending'
  );

insert into public.submissions (
  id, task_id, employee_id, note, submitted_at
) values (
  pg_temp.audit_id('submission'),
  pg_temp.audit_id('submitted_task'),
  pg_temp.audit_id('worker_two'),
  'RBAC fixture submission',
  now()
);

insert into public.ratings (
  id, employee_id, rated_by, score, ai_suggested_score,
  ai_summary, comment, period
) values (
  pg_temp.audit_id('rating'),
  pg_temp.audit_id('worker_one'),
  pg_temp.audit_id('non_worker'),
  4,
  4,
  'RBAC fixture rating',
  'Fixture',
  '2026-07'
);

-- ---------------------------------------------------------------------------
-- Structural security baseline.
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'profiles has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.tasks'::regclass),
  'tasks has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.submissions'::regclass),
  'submissions has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.ratings'::regclass),
  'ratings has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.activity_log'::regclass),
  'activity_log has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.roles'::regclass),
  'roles has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.permissions'::regclass),
  'permissions has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.role_permissions'::regclass),
  'role_permissions has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  'storage.objects has RLS enabled'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.protect_task_columns()',
    'execute'
  ),
  'authenticated cannot execute the task protection trigger directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.protect_submission_columns()',
    'execute'
  ),
  'authenticated cannot execute the submission protection trigger directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.protect_profile_columns()',
    'execute'
  ),
  'authenticated cannot execute the profile protection trigger directly'
);

-- Anonymous callers have table grants, but no RLS policy admits rows.
select pg_temp.clear_auth();
set local role anon;
select is_empty(
  $$select id from public.tasks$$,
  'anonymous callers cannot read tasks'
);
select is_empty(
  $$select id from public.roles$$,
  'anonymous callers cannot read the RBAC catalogue'
);
reset role;

-- ---------------------------------------------------------------------------
-- No permission and ownership baseline.
-- ---------------------------------------------------------------------------

select pg_temp.set_audit_permissions(array[]::text[]);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;

select is(
  (select count(*) from public.tasks),
  1::bigint,
  'without task.view_all an active user sees only their own task'
);
select is_empty(
  $$select id from public.submissions$$,
  'without submission.review a user cannot read another worker submission'
);
select is(
  public.has_permission('permission.does_not_exist'),
  false,
  'unknown permission keys fail closed'
);
select throws_ok(
  $$select * from public.admin_list_users()$$
);
select throws_ok(
  $$
    insert into public.tasks (
      title, assigned_to, assigned_by, priority, deadline, status
    ) values (
      'Denied task',
      pg_temp.audit_id('worker_one'),
      pg_temp.audit_id('actor'),
      'medium',
      now() + interval '1 day',
      'pending'
    )
  $$
);
select throws_ok(
  $$
    insert into public.ratings (
      employee_id, rated_by, score, ai_suggested_score, period
    ) values (
      pg_temp.audit_id('worker_one'),
      pg_temp.audit_id('actor'),
      4,
      4,
      '2026-08'
    )
  $$
);
reset role;
select pg_temp.clear_auth();

-- ---------------------------------------------------------------------------
-- Task read/create and task-attachment storage.
-- ---------------------------------------------------------------------------

select pg_temp.set_audit_permissions(array['task.view_all']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select ok(
  (select count(*) from public.tasks) >= 4,
  'task.view_all exposes all active fixture tasks'
);
select is_empty(
  $$select id from public.submissions$$,
  'task.view_all does not imply submission.review'
);
reset role;
select pg_temp.clear_auth();

select pg_temp.set_audit_permissions(array['task.create']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select lives_ok(
  $$
    insert into public.tasks (
      title, assigned_to, assigned_by, priority, deadline, status
    ) values (
      'Allowed task',
      pg_temp.audit_id('worker_one'),
      pg_temp.audit_id('actor'),
      'medium',
      now() + interval '1 day',
      'pending'
    )
  $$,
  'task.create allows a pending task for an accepted active worker'
);
select throws_ok(
  $$
    insert into public.tasks (
      title, assigned_to, assigned_by, priority, deadline, status
    ) values (
      'Forged author',
      pg_temp.audit_id('worker_one'),
      pg_temp.audit_id('non_worker'),
      'medium',
      now() + interval '1 day',
      'pending'
    )
  $$
);
select throws_ok(
  $$
    insert into public.tasks (
      title, assigned_to, assigned_by, priority, deadline, status
    ) values (
      'Invalid assignee',
      pg_temp.audit_id('non_worker'),
      pg_temp.audit_id('actor'),
      'medium',
      now() + interval '1 day',
      'pending'
    )
  $$
);
select lives_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'task-attachments',
      auth.uid()::text || '/rbac-task-attachment.txt'
    )
  $$,
  'task.create permits an attachment in the caller folder'
);
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'task-attachments',
      pg_temp.audit_id('worker_one')::text || '/forged-task-attachment.txt'
    )
  $$
);
reset role;
select pg_temp.clear_auth();

-- ---------------------------------------------------------------------------
-- Task update/archive bundles.
-- ---------------------------------------------------------------------------

select pg_temp.set_audit_permissions(array['task.view_all', 'task.update']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select lives_ok(
  $$
    update public.tasks
    set title = 'RBAC worker task edited'
    where id = pg_temp.audit_id('worker_task')
  $$,
  'task.view_all + task.update can edit task definition fields'
);
select throws_ok(
  $$
    update public.tasks
    set status = 'completed'
    where id = pg_temp.audit_id('worker_task')
  $$
);
select lives_ok(
  $$
    update public.tasks
    set assigned_to = pg_temp.audit_id('worker_two')
    where id = pg_temp.audit_id('worker_task')
  $$,
  'task.update can reassign to another accepted worker'
);
select throws_ok(
  $$
    update public.tasks
    set assigned_to = pg_temp.audit_id('non_worker')
    where id = pg_temp.audit_id('worker_task')
  $$
);
reset role;
select pg_temp.clear_auth();

select pg_temp.set_audit_permissions(array['task.view_all', 'task.archive']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select lives_ok(
  $$
    update public.tasks
    set deleted_at = now()
    where id = pg_temp.audit_id('archive_task')
  $$,
  'task.view_all + task.archive can archive a task'
);
select throws_ok(
  $$
    update public.tasks
    set title = 'Archive permission must not edit'
    where id = pg_temp.audit_id('worker_task')
  $$
);
reset role;
select pg_temp.clear_auth();

-- ---------------------------------------------------------------------------
-- Own-task work and submission permissions.
-- ---------------------------------------------------------------------------

select pg_temp.set_audit_permissions(array['submission.create']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select lives_ok(
  $$
    update public.tasks
    set status = 'in_progress'
    where id = pg_temp.audit_id('own_task')
  $$,
  'submission.create lets the owner start their own pending task'
);
select lives_ok(
  $$
    insert into public.submissions (task_id, employee_id, note)
    values (
      pg_temp.audit_id('own_task'),
      pg_temp.audit_id('actor'),
      'RBAC allowed own submission'
    )
  $$,
  'submission.create permits a submission for the caller own active task'
);
select lives_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'submissions',
      auth.uid()::text || '/rbac-own-submission.txt'
    )
  $$,
  'submission.create permits upload in the caller submission folder'
);
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'submissions',
      pg_temp.audit_id('worker_one')::text || '/forged-submission.txt'
    )
  $$
);
reset role;
select pg_temp.clear_auth();

select pg_temp.set_audit_permissions(array[]::text[]);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select is_empty(
  $$
    update public.tasks
    set status = 'submitted'
    where id = pg_temp.audit_id('own_task')
    returning id
  $$,
  'without submission.create the owner status update changes no rows'
);
select throws_ok(
  $$
    insert into public.submissions (task_id, employee_id, note)
    values (
      pg_temp.audit_id('own_task'),
      pg_temp.audit_id('actor'),
      'RBAC denied own submission'
    )
  $$
);
select throws_ok(
  $$
    insert into storage.objects (bucket_id, name)
    values (
      'submissions',
      auth.uid()::text || '/rbac-denied-submission.txt'
    )
  $$
);
reset role;
select pg_temp.clear_auth();

-- ---------------------------------------------------------------------------
-- Submission review.
-- ---------------------------------------------------------------------------

select pg_temp.set_audit_permissions(
  array['task.view_all', 'submission.review']
);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select ok(
  (select count(*) from public.submissions) >= 1,
  'submission.review reads other worker submissions'
);
select lives_ok(
  $$
    update public.submissions
    set hr_feedback = 'RBAC reviewed', reviewed_at = now()
    where id = pg_temp.audit_id('submission')
  $$,
  'submission.review can edit feedback fields'
);
select throws_ok(
  $$
    update public.submissions
    set note = 'Forged evidence'
    where id = pg_temp.audit_id('submission')
  $$
);
select lives_ok(
  $$
    update public.tasks
    set status = 'completed'
    where id = pg_temp.audit_id('submitted_task')
  $$,
  'review bundle can approve a submitted task'
);
select throws_ok(
  $$
    update public.tasks
    set status = 'completed'
    where id = pg_temp.audit_id('worker_task')
  $$
);
reset role;
select pg_temp.clear_auth();

-- ---------------------------------------------------------------------------
-- Performance and rating permissions.
-- ---------------------------------------------------------------------------

select pg_temp.set_audit_permissions(array['stats.view_all']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select ok(
  (
    select count(distinct employee_id)
    from public.activity_log
  ) >= 2,
  'stats.view_all reads activity for multiple workers'
);
select lives_ok(
  $$select * from public.admin_list_users()$$,
  'stats.view_all can list worker choices for the performance picker'
);
select is_empty(
  $$
    select id from public.tasks
    where assigned_to <> auth.uid()
  $$,
  'stats.view_all alone does not imply task.view_all'
);
reset role;
select pg_temp.clear_auth();

select pg_temp.set_audit_permissions(array['rating.view_all']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select ok(
  (select count(*) from public.ratings) >= 1,
  'rating.view_all reads ratings for other workers'
);
select throws_ok(
  $$
    insert into public.ratings (
      employee_id, rated_by, score, ai_suggested_score, period
    ) values (
      pg_temp.audit_id('worker_one'),
      pg_temp.audit_id('actor'),
      4,
      4,
      '2026-08'
    )
  $$
);
reset role;
select pg_temp.clear_auth();

select pg_temp.set_audit_permissions(array['rating.create']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select lives_ok(
  $$
    insert into public.ratings (
      employee_id, rated_by, score, ai_suggested_score, period
    ) values (
      pg_temp.audit_id('worker_one'),
      pg_temp.audit_id('actor'),
      4,
      4,
      '2026-08'
    )
  $$,
  'rating.create can rate an active accepted worker'
);
select throws_ok(
  $$
    insert into public.ratings (
      employee_id, rated_by, score, ai_suggested_score, period
    ) values (
      pg_temp.audit_id('worker_one'),
      pg_temp.audit_id('non_worker'),
      4,
      4,
      '2026-08'
    )
  $$
);
select throws_ok(
  $$
    insert into public.ratings (
      employee_id, rated_by, score, ai_suggested_score, period
    ) values (
      pg_temp.audit_id('non_worker'),
      pg_temp.audit_id('actor'),
      4,
      4,
      '2026-08'
    )
  $$
);
select throws_ok(
  $$
    insert into public.ratings (
      employee_id, rated_by, score, ai_suggested_score, period
    ) values (
      pg_temp.audit_id('actor'),
      pg_temp.audit_id('actor'),
      4,
      4,
      '2026-08'
    )
  $$
);
select is_empty(
  $$
    update public.ratings
    set comment = 'Ratings are append-only'
    where id = pg_temp.audit_id('rating')
    returning id
  $$,
  'ratings cannot be updated'
);
select is_empty(
  $$
    delete from public.ratings
    where id = pg_temp.audit_id('rating')
    returning id
  $$,
  'ratings cannot be deleted'
);
reset role;
select pg_temp.clear_auth();

-- ---------------------------------------------------------------------------
-- User-management permissions.
-- ---------------------------------------------------------------------------

select pg_temp.set_audit_permissions(array['user.invite']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select lives_ok(
  $$select * from public.admin_list_users()$$,
  'user.invite can open the worker-scoped Users page data source'
);
reset role;
select pg_temp.clear_auth();

select pg_temp.set_audit_permissions(array['user.promote']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select lives_ok(
  $$
    update public.profiles
    set role_id = (
      select id from public.roles where name = 'audit_hr_target_role'
    )
    where id = pg_temp.audit_id('worker_two')
  $$,
  'user.promote can move a worker into an HR-grantable role'
);
reset role;
select pg_temp.clear_auth();
update public.profiles
set role_id = (select id from public.roles where name = 'audit_worker_role')
where id = pg_temp.audit_id('worker_two');

select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select throws_ok(
  $$
    update public.profiles
    set role_id = (
      select id from public.roles where name = 'audit_non_worker_role'
    )
    where id = pg_temp.audit_id('worker_two')
  $$
);
reset role;
select pg_temp.clear_auth();

select pg_temp.set_audit_permissions(array['user.archive']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select lives_ok(
  $$
    update public.profiles
    set deleted_at = now()
    where id = pg_temp.audit_id('worker_one')
  $$,
  'user.archive can archive an active worker'
);
select is_empty(
  $$
    update public.profiles
    set deleted_at = now()
    where id = pg_temp.audit_id('non_worker')
    returning id
  $$,
  'user.archive cannot archive a non-worker'
);
reset role;
select pg_temp.clear_auth();
update public.profiles
set deleted_at = null
where id = pg_temp.audit_id('worker_one');

select pg_temp.set_audit_permissions(array['user.manage_all']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select lives_ok(
  $$
    update public.profiles
    set role_id = (
      select id from public.roles where name = 'audit_hr_target_role'
    )
    where id = pg_temp.audit_id('non_worker')
  $$,
  'user.manage_all can change another user to a non-protected role'
);
select throws_ok(
  $$
    update public.profiles
    set role_id = (
      select id from public.roles where name = 'audit_non_worker_role'
    )
    where id = pg_temp.audit_id('actor')
  $$
);
select throws_ok(
  $$
    update public.profiles
    set role_id = (
      select id from public.roles where name = 'admin'
    )
    where id = pg_temp.audit_id('worker_two')
  $$
);
reset role;
select pg_temp.clear_auth();
update public.profiles
set role_id = (select id from public.roles where name = 'audit_non_worker_role')
where id = pg_temp.audit_id('non_worker');

-- ---------------------------------------------------------------------------
-- Role management and role flags.
-- ---------------------------------------------------------------------------

select pg_temp.set_audit_permissions(array['role.manage']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select lives_ok(
  $$
    insert into public.roles (
      name, assignable_work, protected, hr_grantable
    ) values (
      'audit_created_role', false, false, false
    )
  $$,
  'role.manage can create a non-protected custom role'
);
select lives_ok(
  $$
    update public.roles
    set assignable_work = true
    where name = 'audit_created_role'
  $$,
  'role.manage can update a non-protected custom role'
);
select lives_ok(
  $$
    insert into public.role_permissions (role_id, permission_id)
    select r.id, p.id
    from public.roles r
    cross join public.permissions p
    where r.name = 'audit_created_role'
      and p.key = 'task.view_all'
  $$,
  'role.manage can edit a custom role keyring'
);
select throws_ok(
  $$
    insert into public.roles (
      name, assignable_work, protected, hr_grantable
    ) values (
      'audit_illegal_protected', false, true, false
    )
  $$
);
select throws_ok(
  $$
    update public.roles
    set name = 'renamed_admin'
    where name = 'admin'
  $$
);
select throws_ok(
  $$
    delete from public.role_permissions
    where role_id = (select id from public.roles where name = 'admin')
      and permission_id = (
        select id from public.permissions where key = 'role.manage'
      )
  $$
);
select lives_ok(
  $$delete from public.roles where name = 'audit_created_role'$$,
  'role.manage can delete an unused custom role'
);
reset role;
select pg_temp.clear_auth();

select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
select throws_ok(
  $$
    update public.roles
    set assignable_work = false
    where name = 'audit_worker_role'
  $$
);
select pg_temp.clear_auth();

-- ---------------------------------------------------------------------------
-- Archived-user fail-closed behavior.
-- ---------------------------------------------------------------------------

select pg_temp.set_audit_permissions(
  array[
    'task.view_all',
    'submission.review',
    'rating.view_all',
    'stats.view_all',
    'role.manage'
  ]
);
select pg_temp.authenticate_as(pg_temp.audit_id('archived_actor'));
set local role authenticated;
select is(
  public.has_permission('role.manage'),
  false,
  'archived users hold no effective permissions'
);
select is_empty(
  $$select id from public.tasks$$,
  'archived users cannot read tasks'
);
select is_empty(
  $$select id from public.submissions$$,
  'archived users cannot read submissions'
);
select is_empty(
  $$select id from public.ratings$$,
  'archived users cannot read ratings'
);
select is_empty(
  $$select id from public.activity_log$$,
  'archived users cannot read activity'
);
select is(
  (select count(*) from public.profiles),
  1::bigint,
  'archived users can read only their own profile for deactivation handling'
);
select is_empty(
  $$select id from public.roles$$,
  'archived users cannot read roles'
);
select is_empty(
  $$select id from public.permissions$$,
  'archived users cannot read permission definitions'
);
select is_empty(
  $$select role_id from public.role_permissions$$,
  'archived users cannot read role keyrings'
);
reset role;
select pg_temp.clear_auth();

-- Permission changes are live: no session/JWT refresh is needed because the
-- authorization pivot reads the keyring directly from Postgres.
select pg_temp.set_audit_permissions(array['task.view_all']);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select is(
  public.has_permission('task.view_all'),
  true,
  'granting a permission takes effect immediately'
);
reset role;
select pg_temp.clear_auth();
select pg_temp.set_audit_permissions(array[]::text[]);
select pg_temp.authenticate_as(pg_temp.audit_id('actor'));
set local role authenticated;
select is(
  public.has_permission('task.view_all'),
  false,
  'removing a permission takes effect immediately'
);
reset role;
select pg_temp.clear_auth();

-- finish(true) raises if any assertion failed. On failure the connection
-- transaction is aborted; on success the explicit ROLLBACK below cleans up.
select * from finish(true);
rollback;

select 'Feature 11 RBAC permission matrix passed; all fixtures rolled back.' as result;
