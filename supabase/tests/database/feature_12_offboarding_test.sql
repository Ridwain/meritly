-- Feature 12: offboarding, custody, audit, and historical access.
--
-- Fixtures are isolated inside one transaction and never persist.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select * from no_plan();

create temporary table feature_12_ids (
  name text primary key,
  id uuid not null
);

insert into feature_12_ids (name, id) values
  ('actor',       'e1200000-0000-4000-8000-000000000001'),
  ('target',      'e1200000-0000-4000-8000-000000000002'),
  ('replacement', 'e1200000-0000-4000-8000-000000000003'),
  ('queued',      'e1200000-0000-4000-8000-000000000004'),
  ('no_access',   'e1200000-0000-4000-8000-000000000005'),
  ('pending_task','f1200000-0000-4000-8000-000000000001'),
  ('submitted',   'f1200000-0000-4000-8000-000000000002'),
  ('queued_task', 'f1200000-0000-4000-8000-000000000003'),
  ('submission',  'a1200000-0000-4000-8000-000000000001'),
  ('transfer_req','b1200000-0000-4000-8000-000000000001'),
  ('queue_req',   'b1200000-0000-4000-8000-000000000002');

create function pg_temp.feature_12_id(label text)
returns uuid
language sql
stable
as $$
  select id from pg_temp.feature_12_ids where name = label;
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

create function pg_temp.set_feature_12_permissions(
  target_role_name text,
  keys text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role_id integer;
begin
  select id into target_role_id
  from public.roles
  where name = target_role_name;

  delete from public.role_permissions
  where role_id = target_role_id;

  insert into public.role_permissions (role_id, permission_id)
  select target_role_id, p.id
  from public.permissions p
  where p.key = any(keys);
end;
$$;

select pg_temp.clear_auth();

insert into public.roles (name, assignable_work, protected, hr_grantable) values
  ('feature_12_manager', false, false, false),
  ('feature_12_worker', true, false, false),
  ('feature_12_non_worker', false, false, true),
  ('feature_12_no_access', false, false, false);

select pg_temp.set_feature_12_permissions(
  'feature_12_manager',
  array[
    'user.archive',
    'user.promote',
    'task.view_all',
    'task.update',
    'stats.view_all'
  ]
);

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
    (
      pg_temp.feature_12_id('actor'),
      'feature-12-actor@example.test',
      'Feature 12 Manager'
    ),
    (
      pg_temp.feature_12_id('target'),
      'feature-12-target@example.test',
      'Feature 12 Target'
    ),
    (
      pg_temp.feature_12_id('replacement'),
      'feature-12-replacement@example.test',
      'Feature 12 Replacement'
    ),
    (
      pg_temp.feature_12_id('queued'),
      'feature-12-queued@example.test',
      'Feature 12 Queued'
    ),
    (
      pg_temp.feature_12_id('no_access'),
      'feature-12-no-access@example.test',
      'Feature 12 No Access'
    )
) as fixture(id, email, full_name);

update public.profiles
set
  role_id = case
    when id = pg_temp.feature_12_id('actor')
      then (select id from public.roles where name = 'feature_12_manager')
    when id = pg_temp.feature_12_id('no_access')
      then (select id from public.roles where name = 'feature_12_no_access')
    else (select id from public.roles where name = 'feature_12_worker')
  end,
  accepted_at = now()
where id in (
  pg_temp.feature_12_id('actor'),
  pg_temp.feature_12_id('target'),
  pg_temp.feature_12_id('replacement'),
  pg_temp.feature_12_id('queued'),
  pg_temp.feature_12_id('no_access')
);

insert into public.tasks (
  id, title, assigned_to, assigned_by, priority, deadline, status
) values
  (
    pg_temp.feature_12_id('pending_task'),
    'Transfer during offboarding',
    pg_temp.feature_12_id('target'),
    pg_temp.feature_12_id('actor'),
    'medium',
    now() + interval '7 days',
    'pending'
  ),
  (
    pg_temp.feature_12_id('submitted'),
    'Submitted evidence stays attributed',
    pg_temp.feature_12_id('target'),
    pg_temp.feature_12_id('actor'),
    'high',
    now() + interval '2 days',
    'submitted'
  ),
  (
    pg_temp.feature_12_id('queued_task'),
    'Queue without replacement',
    pg_temp.feature_12_id('queued'),
    pg_temp.feature_12_id('actor'),
    'low',
    now() + interval '9 days',
    'in_progress'
  );

insert into public.submissions (
  id, task_id, employee_id, note, submitted_at
) values (
  pg_temp.feature_12_id('submission'),
  pg_temp.feature_12_id('submitted'),
  pg_temp.feature_12_id('target'),
  'Original employee evidence',
  now()
);

select ok(
  (select relrowsecurity
   from pg_class
   where oid = 'public.user_lifecycle_events'::regclass),
  'lifecycle events have RLS enabled'
);
select ok(
  (select relrowsecurity
   from pg_class
   where oid = 'public.task_assignment_history'::regclass),
  'assignment history has RLS enabled'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.user_lifecycle_events',
    'INSERT'
  ),
  'authenticated cannot insert lifecycle audit rows'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'public.task_assignment_history',
    'UPDATE'
  ),
  'authenticated cannot update assignment history'
);

select pg_temp.authenticate_as(pg_temp.feature_12_id('actor'));
set local role authenticated;

select lives_ok(
  format(
    'select * from public.offboard_user(%L, %L, %L, null, %L, %L)',
    pg_temp.feature_12_id('transfer_req'),
    pg_temp.feature_12_id('target'),
    'archive',
    pg_temp.feature_12_id('replacement'),
    'Employment ended'
  ),
  'archive and optional task transfer commit atomically'
);

select is(
  (
    select assigned_to
    from public.tasks
    where id = pg_temp.feature_12_id('pending_task')
  ),
  pg_temp.feature_12_id('replacement'),
  'transferable work moves to the replacement'
);
select is(
  (
    select assigned_to
    from public.tasks
    where id = pg_temp.feature_12_id('submitted')
  ),
  pg_temp.feature_12_id('target'),
  'submitted work stays with its original employee'
);
select is(
  (
    select reassigned_task_count
    from public.user_lifecycle_events
    where request_id = pg_temp.feature_12_id('transfer_req')
  ),
  1,
  'lifecycle event records the transferred-task count'
);
select is(
  (
    select submitted_task_count
    from public.user_lifecycle_events
    where request_id = pg_temp.feature_12_id('transfer_req')
  ),
  1,
  'lifecycle event records submitted work awaiting review'
);
select is(
  (
    select count(*)
    from public.task_assignment_history
    where request_id = pg_temp.feature_12_id('transfer_req')
  ),
  1::bigint,
  'task ownership change has one immutable history row'
);
select is(
  (
    select duplicate_request
    from public.offboard_user(
      pg_temp.feature_12_id('transfer_req'),
      pg_temp.feature_12_id('target'),
      'archive',
      null,
      pg_temp.feature_12_id('replacement'),
      'Employment ended'
    )
  ),
  true,
  'reusing the request id returns the original result'
);
select is(
  (
    select count(*)
    from public.user_lifecycle_events
    where request_id = pg_temp.feature_12_id('transfer_req')
  ),
  1::bigint,
  'an idempotent retry does not duplicate lifecycle history'
);

select lives_ok(
  format(
    'select * from public.offboard_user(%L, %L, %L, null, null, %L)',
    pg_temp.feature_12_id('queue_req'),
    pg_temp.feature_12_id('queued'),
    'archive',
    'Immediate access revocation'
  ),
  'archive succeeds without choosing a replacement'
);
select is(
  (
    select queued_task_count
    from public.user_lifecycle_events
    where request_id = pg_temp.feature_12_id('queue_req')
  ),
  1,
  'no-replacement audit records unresolved transferable work'
);
select is(
  (
    select category
    from public.offboarding_queue()
    where task_id = pg_temp.feature_12_id('queued_task')
  ),
  'needs_reassignment',
  'unresolved work appears in the custody queue'
);
select is(
  (
    select category
    from public.offboarding_queue()
    where task_id = pg_temp.feature_12_id('submitted')
  ),
  'needs_review',
  'submitted work from an archived employee appears as needs review'
);
select throws_ok(
  format(
    'update public.tasks set assigned_to = %L where id = %L',
    pg_temp.feature_12_id('replacement'),
    pg_temp.feature_12_id('submitted')
  ),
  'submitted tasks cannot be reassigned'
);
select ok(
  public.can_view_performance_subject(pg_temp.feature_12_id('target')),
  'archived employee with history remains a performance subject'
);
select is(
  (
    select count(*)
    from public.historical_employees()
    where id = pg_temp.feature_12_id('target')
  ),
  1::bigint,
  'archived employee remains in the historical picker'
);

reset role;
select pg_temp.clear_auth();

select pg_temp.authenticate_as(pg_temp.feature_12_id('no_access'));
set local role authenticated;
select throws_ok(
  format(
    'select * from public.offboard_user(gen_random_uuid(), %L, %L, null, null, %L)',
    pg_temp.feature_12_id('replacement'),
    'archive',
    'Unauthorized attempt'
  ),
  'a user without lifecycle permission cannot offboard'
);
select is_empty(
  $$select id from public.user_lifecycle_events$$,
  'a user without management permission cannot read lifecycle audit rows'
);

reset role;
select pg_temp.clear_auth();

select throws_ok(
  $$
    update public.user_lifecycle_events
    set reason = 'Rewritten audit reason'
    where request_id = pg_temp.feature_12_id('transfer_req')
  $$,
  'audit history rejects direct updates'
);

select * from finish();
rollback;
