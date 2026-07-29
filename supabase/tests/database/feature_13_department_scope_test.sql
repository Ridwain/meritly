-- Feature 13: department isolation, transfer audit, and file-parent scope.
-- All fixtures live inside one transaction and are rolled back.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select * from no_plan();

create temporary table feature_13_ids (
  name text primary key,
  id uuid not null
);
grant select on feature_13_ids to authenticated;

insert into feature_13_ids (name, id) values
  ('manager_a', 'e1300000-0000-4000-8000-000000000001'),
  ('manager_b', 'e1300000-0000-4000-8000-000000000002'),
  ('global',    'e1300000-0000-4000-8000-000000000003'),
  ('worker_a',  'e1300000-0000-4000-8000-000000000004'),
  ('worker_b',  'e1300000-0000-4000-8000-000000000005'),
  ('task_a',    'f1300000-0000-4000-8000-000000000001'),
  ('task_b',    'f1300000-0000-4000-8000-000000000002'),
  ('move_req',  'a1300000-0000-4000-8000-000000000001');

create function pg_temp.feature_13_id(label text)
returns uuid
language sql
stable
as $$
  select id from pg_temp.feature_13_ids where name = label;
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

create function pg_temp.set_role_permissions(
  role_name text,
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
  where name = role_name;

  insert into public.role_permissions (role_id, permission_id)
  select target_role_id, p.id
  from public.permissions p
  where p.key = any(keys);
end;
$$;

select pg_temp.clear_auth();

insert into public.departments (name) values
  ('Feature 13 Alpha'),
  ('Feature 13 Beta');

insert into public.roles (
  name, assignable_work, protected, hr_grantable
) values
  ('feature_13_manager', false, false, false),
  ('feature_13_global', false, false, false),
  ('feature_13_worker', true, false, false);

select pg_temp.set_role_permissions(
  'feature_13_manager',
  array[
    'task.view_all',
    'task.create',
    'task.update',
    'stats.view_all',
    'user.invite'
  ]
);
select pg_temp.set_role_permissions(
  'feature_13_global',
  array[
    'task.view_all',
    'task.create',
    'task.update',
    'stats.view_all',
    'user.invite',
    'user.manage_all'
  ]
);
select pg_temp.set_role_permissions(
  'feature_13_worker',
  array['submission.create']
);

-- These are direct database fixtures, not production Auth invitations.
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
  '{}'::jsonb,
  now(),
  now()
from (
  values
    (pg_temp.feature_13_id('manager_a'), 'f13-manager-a@example.test'),
    (pg_temp.feature_13_id('manager_b'), 'f13-manager-b@example.test'),
    (pg_temp.feature_13_id('global'), 'f13-global@example.test'),
    (pg_temp.feature_13_id('worker_a'), 'f13-worker-a@example.test'),
    (pg_temp.feature_13_id('worker_b'), 'f13-worker-b@example.test')
) as fixture(id, email);

alter table auth.users enable trigger on_auth_user_created;

insert into public.profiles (
  id, full_name, role_id, department_id, accepted_at
) values
  (
    pg_temp.feature_13_id('manager_a'),
    'Feature 13 Manager A',
    (select id from public.roles where name = 'feature_13_manager'),
    (select id from public.departments where name = 'Feature 13 Alpha'),
    now()
  ),
  (
    pg_temp.feature_13_id('manager_b'),
    'Feature 13 Manager B',
    (select id from public.roles where name = 'feature_13_manager'),
    (select id from public.departments where name = 'Feature 13 Beta'),
    now()
  ),
  (
    pg_temp.feature_13_id('global'),
    'Feature 13 Global',
    (select id from public.roles where name = 'feature_13_global'),
    (select id from public.departments where name = 'Feature 13 Alpha'),
    now()
  ),
  (
    pg_temp.feature_13_id('worker_a'),
    'Feature 13 Worker A',
    (select id from public.roles where name = 'feature_13_worker'),
    (select id from public.departments where name = 'Feature 13 Alpha'),
    now()
  ),
  (
    pg_temp.feature_13_id('worker_b'),
    'Feature 13 Worker B',
    (select id from public.roles where name = 'feature_13_worker'),
    (select id from public.departments where name = 'Feature 13 Beta'),
    now()
  );

insert into public.tasks (
  id,
  title,
  assigned_to,
  assigned_by,
  deadline,
  attachment_path,
  attachment_name
) values
  (
    pg_temp.feature_13_id('task_a'),
    'Alpha department task',
    pg_temp.feature_13_id('worker_a'),
    pg_temp.feature_13_id('manager_a'),
    now() + interval '2 days',
    'feature-13/alpha.txt',
    'alpha.txt'
  ),
  (
    pg_temp.feature_13_id('task_b'),
    'Beta department task',
    pg_temp.feature_13_id('worker_b'),
    pg_temp.feature_13_id('manager_b'),
    now() + interval '2 days',
    'feature-13/beta.txt',
    'beta.txt'
  );

insert into storage.objects (bucket_id, name) values
  ('task-attachments', 'feature-13/alpha.txt'),
  ('task-attachments', 'feature-13/beta.txt');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.departments'::regclass),
  'departments have RLS enabled'
);
select ok(
  (select relrowsecurity
   from pg_class
   where oid = 'public.user_department_history'::regclass),
  'department history has RLS enabled'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.prepare_user_invite(text,text,integer,uuid)',
    'EXECUTE'
  ),
  'browser users cannot call the privileged provisioning function'
);

select pg_temp.authenticate_as(pg_temp.feature_13_id('manager_a'));
set local role authenticated;

select is(
  (
    select count(*)
    from public.tasks
    where id in (
      pg_temp.feature_13_id('task_a'),
      pg_temp.feature_13_id('task_b')
    )
  ),
  1::bigint,
  'a scoped manager reads only tasks assigned inside their department'
);
select is(
  (
    select count(*)
    from public.admin_list_users()
    where id in (
      pg_temp.feature_13_id('worker_a'),
      pg_temp.feature_13_id('worker_b')
    )
  ),
  1::bigint,
  'the user list includes only same-department workers'
);
select is(
  (select count(*) from public.assignable_employees()),
  1::bigint,
  'the assignee picker includes only same-department workers'
);
select is(
  (
    select count(*)
    from storage.objects
    where name like 'feature-13/%'
  ),
  1::bigint,
  'Storage SELECT follows the visible parent task'
);
select throws_ok(
  format(
    $sql$
      insert into public.tasks (
        title, assigned_to, assigned_by, deadline
      ) values ('Cross department task', %L, %L, now() + interval '1 day')
    $sql$,
    pg_temp.feature_13_id('worker_b'),
    pg_temp.feature_13_id('manager_a')
  ),
  'a scoped manager cannot assign a cross-department task'
);
select throws_ok(
  format(
    'select * from public.move_user_department(gen_random_uuid(), %L, %L, %L)',
    pg_temp.feature_13_id('worker_a'),
    (select id from public.departments where name = 'Feature 13 Beta'),
    'Unauthorized move'
  ),
  'a scoped manager cannot move department membership'
);
select throws_ok(
  $$insert into public.departments (name) values ('Unauthorized department')$$,
  'department.manage is required to create departments'
);

reset role;
select pg_temp.clear_auth();

select pg_temp.authenticate_as(pg_temp.feature_13_id('global'));
set local role authenticated;

select is(
  (
    select count(*)
    from public.tasks
    where id in (
      pg_temp.feature_13_id('task_a'),
      pg_temp.feature_13_id('task_b')
    )
  ),
  2::bigint,
  'a global manager can read both departments'
);
select lives_ok(
  format(
    'select * from public.move_user_department(%L, %L, %L, %L)',
    pg_temp.feature_13_id('move_req'),
    pg_temp.feature_13_id('worker_a'),
    (select id from public.departments where name = 'Feature 13 Beta'),
    'Employee transferred to Beta'
  ),
  'global department transfer succeeds atomically'
);
select is(
  (
    select duplicate_request
    from public.move_user_department(
      pg_temp.feature_13_id('move_req'),
      pg_temp.feature_13_id('worker_a'),
      (select id from public.departments where name = 'Feature 13 Beta'),
      'Employee transferred to Beta'
    )
  ),
  true,
  'repeating the transfer request is idempotent'
);
select is(
  (
    select count(*)
    from public.user_department_history
    where request_id = pg_temp.feature_13_id('move_req')
  ),
  1::bigint,
  'one immutable audit event records the transfer'
);

reset role;
select pg_temp.clear_auth();

select pg_temp.authenticate_as(pg_temp.feature_13_id('manager_a'));
set local role authenticated;
select is(
  (
    select count(*)
    from public.tasks
    where id in (
      pg_temp.feature_13_id('task_a'),
      pg_temp.feature_13_id('task_b')
    )
  ),
  0::bigint,
  'the old department loses access immediately after transfer'
);

reset role;
select pg_temp.clear_auth();

select pg_temp.authenticate_as(pg_temp.feature_13_id('manager_b'));
set local role authenticated;
select is(
  (
    select count(*)
    from public.tasks
    where id in (
      pg_temp.feature_13_id('task_a'),
      pg_temp.feature_13_id('task_b')
    )
  ),
  2::bigint,
  'the destination department receives current and historical work access'
);

reset role;
select pg_temp.clear_auth();

select throws_ok(
  $$
    update public.user_department_history
    set reason = 'Rewritten transfer reason'
    where request_id = pg_temp.feature_13_id('move_req')
  $$,
  'department transfer history rejects direct updates'
);

select * from finish();
rollback;
