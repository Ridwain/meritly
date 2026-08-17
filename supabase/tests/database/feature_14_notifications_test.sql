-- Feature 14: durable, private, realtime notification security and event map.
-- All fixtures and assertions are rolled back, so this is safe to rerun.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select * from no_plan();

create temporary table feature_14_ids (
  name text primary key,
  id uuid not null
);

insert into feature_14_ids (name, id) values
  ('hr',       'e1400000-0000-4000-8000-000000000001'),
  ('worker_a', 'e1400000-0000-4000-8000-000000000002'),
  ('worker_b', 'e1400000-0000-4000-8000-000000000003'),
  ('archived', 'e1400000-0000-4000-8000-000000000004'),
  ('unaccepted','e1400000-0000-4000-8000-000000000005'),
  ('task',     'f1400000-0000-4000-8000-000000000001'),
  ('long_task','f1400000-0000-4000-8000-000000000002');

create function pg_temp.feature_14_id(label text)
returns uuid
language sql
stable
as $$
  select id from pg_temp.feature_14_ids where name = label;
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

select pg_temp.clear_auth();

-- Auth provisioning is tested elsewhere. These explicit rows are isolated
-- database fixtures for notification ownership and lifecycle tests.
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
    (pg_temp.feature_14_id('hr'), 'f14-hr@example.test', 'Feature 14 HR'),
    (pg_temp.feature_14_id('worker_a'), 'f14-a@example.test', 'Worker A'),
    (pg_temp.feature_14_id('worker_b'), 'f14-b@example.test', 'Worker B'),
    (pg_temp.feature_14_id('archived'), 'f14-x@example.test', 'Archived Worker'),
    (pg_temp.feature_14_id('unaccepted'), 'f14-u@example.test', 'Unaccepted Worker')
) as fixture(id, email, full_name);

alter table auth.users enable trigger on_auth_user_created;

insert into public.profiles (
  id, full_name, role_id, department_id, accepted_at
)
select
  fixture.id,
  fixture.full_name,
  fixture.role_id,
  (select id from public.departments where name = 'General'),
  now()
from (
  values
    (
      pg_temp.feature_14_id('hr'),
      'Feature 14 HR',
      (select id from public.roles where name = 'hr')
    ),
    (
      pg_temp.feature_14_id('worker_a'),
      'Worker A',
      (select id from public.roles where name = 'employee')
    ),
    (
      pg_temp.feature_14_id('worker_b'),
      'Worker B',
      (select id from public.roles where name = 'employee')
    ),
    (
      pg_temp.feature_14_id('archived'),
      'Archived Worker',
      (select id from public.roles where name = 'employee')
    ),
    (
      pg_temp.feature_14_id('unaccepted'),
      'Unaccepted Worker',
      (select id from public.roles where name = 'employee')
    )
) as fixture(id, full_name, role_id);

update public.profiles
set accepted_at = null
where id = pg_temp.feature_14_id('unaccepted');

update public.profiles
set deleted_at = now()
where id = pg_temp.feature_14_id('archived');

-- -------------------------------------------------------------------------
-- Structure, grants, helper isolation, and private Broadcast policy.
-- -------------------------------------------------------------------------

select has_table('public', 'notifications', 'notifications table exists');
select ok(
  (select relrowsecurity
   from pg_class
   where oid = 'public.notifications'::regclass),
  'notifications has RLS enabled'
);
select col_is_fk(
  'public', 'notifications', 'recipient_id',
  'notification recipient is protected by a foreign key'
);
select col_is_fk(
  'public', 'notifications', 'actor_id',
  'notification actor is protected by a foreign key'
);
select col_is_fk(
  'public', 'notifications', 'task_id',
  'notification task is protected by a foreign key'
);
select has_index(
  'public', 'notifications', 'notifications_recipient_created_idx',
  'recent notification index exists'
);
select has_index(
  'public', 'notifications', 'notifications_recipient_unread_idx',
  'partial unread index exists'
);
select ok(
  has_table_privilege('authenticated', 'public.notifications', 'SELECT'),
  'authenticated users receive SELECT grant'
);
select ok(
  not has_table_privilege('anon', 'public.notifications', 'SELECT'),
  'anonymous users have no SELECT grant'
);
select ok(
  not has_table_privilege('authenticated', 'public.notifications', 'INSERT'),
  'browser users cannot forge notifications'
);
select ok(
  not has_table_privilege('authenticated', 'public.notifications', 'DELETE'),
  'browser users cannot delete notification history'
);
select ok(
  has_column_privilege(
    'authenticated', 'public.notifications', 'read_at', 'UPDATE'
  ),
  'browser users may update only read_at'
);
select ok(
  not has_column_privilege(
    'authenticated', 'public.notifications', 'message', 'UPDATE'
  ),
  'browser users cannot rewrite notification messages'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.create_notification(uuid,uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'notification creation helper is not a public RPC'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.notify_task_change()', 'EXECUTE'
  ),
  'task notification trigger cannot be called directly'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.notify_submission_created()', 'EXECUTE'
  ),
  'submission notification trigger cannot be called directly'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'notification_recipient_can_receive_broadcast'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual like '%notifications:%'
      and qual like '%uid()%'
  ),
  'private Broadcast policy binds the topic to the authenticated user'
);
select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'notification_recipient_can_receive_broadcast'
      and cmd = 'INSERT'
  ),
  'notification policy is receive-only'
);

-- -------------------------------------------------------------------------
-- Trigger event map and no-noise rules.
-- -------------------------------------------------------------------------

select pg_temp.authenticate_as(pg_temp.feature_14_id('hr'));
insert into public.tasks (
  id, title, assigned_to, assigned_by, priority, deadline, status
) values (
  pg_temp.feature_14_id('task'),
  'Feature 14 task',
  pg_temp.feature_14_id('worker_a'),
  pg_temp.feature_14_id('hr'),
  'medium',
  now() + interval '7 days',
  'pending'
);

select is(
  (select count(*) from public.notifications
   where task_id = pg_temp.feature_14_id('task')
     and kind = 'task_assigned'
     and recipient_id = pg_temp.feature_14_id('worker_a')),
  1::bigint,
  'task creation makes exactly one assignment notification'
);

update public.tasks
set assigned_to = pg_temp.feature_14_id('worker_b')
where id = pg_temp.feature_14_id('task');

select is(
  (select count(*) from public.notifications
   where task_id = pg_temp.feature_14_id('task')
     and kind = 'task_reassigned'
     and recipient_id = pg_temp.feature_14_id('worker_b')),
  1::bigint,
  'reassignment notifies only the new assignee'
);
select is(
  (select count(*) from public.notifications
   where task_id = pg_temp.feature_14_id('task')
     and kind = 'task_reassigned'
     and recipient_id = pg_temp.feature_14_id('worker_a')),
  0::bigint,
  'reassignment does not notify the former assignee'
);

-- Replaying the same state does not cross the IS DISTINCT FROM transition.
update public.tasks
set assigned_to = pg_temp.feature_14_id('worker_b')
where id = pg_temp.feature_14_id('task');
select is(
  (select count(*) from public.notifications
   where task_id = pg_temp.feature_14_id('task')
     and kind = 'task_reassigned'),
  1::bigint,
  'same-state replay does not duplicate a reassignment notification'
);

select pg_temp.authenticate_as(pg_temp.feature_14_id('worker_b'));
update public.tasks
set status = 'in_progress'
where id = pg_temp.feature_14_id('task');
insert into public.submissions (task_id, employee_id, note)
values (
  pg_temp.feature_14_id('task'),
  pg_temp.feature_14_id('worker_b'),
  'Completed work'
);
update public.tasks
set status = 'submitted'
where id = pg_temp.feature_14_id('task');

select is(
  (select count(*) from public.notifications
   where task_id = pg_temp.feature_14_id('task')
     and kind = 'work_submitted'
     and recipient_id = pg_temp.feature_14_id('hr')),
  1::bigint,
  'submission notifies the active task creator'
);

select pg_temp.authenticate_as(pg_temp.feature_14_id('hr'));
update public.tasks
set status = 'needs_revision'
where id = pg_temp.feature_14_id('task');
select is(
  (select count(*) from public.notifications
   where task_id = pg_temp.feature_14_id('task')
     and kind = 'revision_requested'
     and recipient_id = pg_temp.feature_14_id('worker_b')),
  1::bigint,
  'revision transition notifies the assigned employee'
);

select pg_temp.authenticate_as(pg_temp.feature_14_id('worker_b'));
update public.tasks
set status = 'submitted'
where id = pg_temp.feature_14_id('task');
select pg_temp.authenticate_as(pg_temp.feature_14_id('hr'));
update public.tasks
set status = 'completed'
where id = pg_temp.feature_14_id('task');
select is(
  (select count(*) from public.notifications
   where task_id = pg_temp.feature_14_id('task')
     and kind = 'work_approved'
     and recipient_id = pg_temp.feature_14_id('worker_b')),
  1::bigint,
  'completion transition notifies the assigned employee'
);

select set_config('meritly.system_update', 'true', true);
update public.tasks
set status = 'overdue'
where id = pg_temp.feature_14_id('task');
select set_config('meritly.system_update', 'false', true);
update public.tasks
set deleted_at = now()
where id = pg_temp.feature_14_id('task');
select is(
  (select count(*) from public.notifications
   where task_id = pg_temp.feature_14_id('task')),
  5::bigint,
  'overdue and archive changes create no extra notification'
);

select lives_ok(
  format(
    $sql$
      insert into public.tasks (
        id, title, assigned_to, assigned_by, priority, deadline, status
      ) values (
        %L, repeat('x', 1000), %L, %L, 'low', now() + interval '1 day',
        'pending'
      )
    $sql$,
    pg_temp.feature_14_id('long_task'),
    pg_temp.feature_14_id('worker_a'),
    pg_temp.feature_14_id('hr')
  ),
  'long task text cannot break the business transaction'
);
select is(
  (select char_length(message) from public.notifications
   where task_id = pg_temp.feature_14_id('long_task')),
  500,
  'long notification display text is safely truncated'
);

-- Inactive recipients are deliberately skipped.
insert into public.notifications (
  recipient_id, actor_id, task_id, kind, title, message, href
)
select
  pg_temp.feature_14_id('worker_a'),
  pg_temp.feature_14_id('hr'),
  pg_temp.feature_14_id('task'),
  'task_assigned', 'RLS fixture', 'Visible only to Worker A',
  '/dashboard/my-tasks';
select private.create_notification(
  pg_temp.feature_14_id('archived'),
  pg_temp.feature_14_id('hr'),
  pg_temp.feature_14_id('task'),
  'task_assigned', 'Skipped', 'Archived recipient', '/dashboard/my-tasks'
);
select is(
  (select count(*) from public.notifications
   where recipient_id = pg_temp.feature_14_id('archived')),
  0::bigint,
  'archived recipients receive no new notifications'
);
select private.create_notification(
  pg_temp.feature_14_id('unaccepted'),
  pg_temp.feature_14_id('hr'),
  pg_temp.feature_14_id('task'),
  'task_assigned', 'Skipped', 'Unaccepted recipient', '/dashboard/my-tasks'
);
select is(
  (select count(*) from public.notifications
   where recipient_id = pg_temp.feature_14_id('unaccepted')),
  0::bigint,
  'unaccepted recipients receive no new notifications'
);

select private.create_notification(
  pg_temp.feature_14_id('hr'),
  pg_temp.feature_14_id('hr'),
  pg_temp.feature_14_id('task'),
  'work_submitted', 'Skipped', 'Self action', '/dashboard/tasks'
);
select is(
  (select count(*) from public.notifications
   where recipient_id = pg_temp.feature_14_id('hr')
     and title = 'Skipped'),
  0::bigint,
  'self-actions do not create notification noise'
);

-- An exception creates a PL/pgSQL subtransaction. The inserted row and its
-- broadcast are both rolled back before the exception handler continues.
do $$
begin
  begin
    insert into public.notifications (
      recipient_id, actor_id, task_id, kind, title, message, href
    ) values (
      pg_temp.feature_14_id('worker_a'),
      pg_temp.feature_14_id('hr'),
      pg_temp.feature_14_id('task'),
      'task_assigned',
      'Must roll back',
      'This transaction fails',
      '/dashboard/my-tasks'
    );
    raise exception 'intentional rollback';
  exception when others then
    null;
  end;
end;
$$;
select is(
  (select count(*) from public.notifications where title = 'Must roll back'),
  0::bigint,
  'failed transactions leave no notification row behind'
);

-- -------------------------------------------------------------------------
-- RLS ownership and column-level mutation protection.
-- -------------------------------------------------------------------------

select pg_temp.authenticate_as(pg_temp.feature_14_id('worker_a'));
set local role authenticated;
select ok(
  (select count(*) from public.notifications) > 0,
  'an active user can read their own notifications'
);
select is_empty(
  format(
    'select id from public.notifications where recipient_id = %L',
    pg_temp.feature_14_id('worker_b')
  ),
  'a user cannot read another recipient notification'
);
select lives_ok(
  $$update public.notifications set read_at = now() where read_at is null$$,
  'a user can mark their own unread notifications as read'
);
select lives_ok(
  format(
    'update public.notifications set read_at = now() where recipient_id = %L',
    pg_temp.feature_14_id('worker_b')
  ),
  'an attempt to mark another user row is safely filtered by RLS'
);
select throws_ok(
  $$update public.notifications set message = 'forged'$$
);
select throws_ok(
  $$delete from public.notifications$$
);
select throws_ok(
  format(
    $sql$
      insert into public.notifications (
        recipient_id, kind, title, message, href
      ) values (%L, 'task_assigned', 'Forged', 'Forged', '/dashboard/my-tasks')
    $sql$,
    pg_temp.feature_14_id('worker_a')
  )
);
reset role;

select is(
  (select count(*) from public.notifications
   where recipient_id = pg_temp.feature_14_id('worker_b')
     and read_at is not null),
  0::bigint,
  'another user notification remained unread'
);

select pg_temp.authenticate_as(pg_temp.feature_14_id('archived'));
set local role authenticated;
select is_empty(
  $$select id from public.notifications$$,
  'an archived user cannot read notifications with an old JWT'
);
reset role;

select pg_temp.clear_auth();
set local role anon;
select throws_ok(
  $$select id from public.notifications$$
);
reset role;

select * from finish();
rollback;
