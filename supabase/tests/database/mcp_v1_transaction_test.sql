-- MCP v1: shared transactions, approval consumption, and idempotency.
-- Every fixture is rolled back at the end.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select * from no_plan();

create temporary table mcp_test_output (
  sequence integer generated always as identity,
  line text not null
);
grant select, insert on mcp_test_output to authenticated;
grant usage, select on sequence mcp_test_output_sequence_seq to authenticated;

create temporary table mcp_v1_ids (
  name text primary key,
  id uuid not null
);
grant select on mcp_v1_ids to authenticated;

-- Reuse byte-for-byte identical timestamps when testing payload idempotency.
-- Calling now() twice would create different hashes a few microseconds apart.
create temporary table mcp_v1_values (
  name text primary key,
  value text not null
);
grant select on mcp_v1_values to authenticated;

insert into mcp_v1_values (name, value) values
  ('web_deadline', (now() + interval '3 days')::text),
  ('mcp_deadline', (now() + interval '5 days')::text);

insert into mcp_v1_ids (name, id) values
  ('start_task',    'f1400000-0000-4000-8000-000000000001'),
  ('web_create',    'a1400000-0000-4000-8000-000000000001'),
  ('worker_start',  'a1400000-0000-4000-8000-000000000002'),
  ('worker_submit', 'a1400000-0000-4000-8000-000000000003'),
  ('manager_review','a1400000-0000-4000-8000-000000000004'),
  ('mcp_create',    'a1400000-0000-4000-8000-000000000005'),
  ('no_approval',   'a1400000-0000-4000-8000-000000000006'),
  ('upload_create', 'a1400000-0000-4000-8000-000000000007'),
  ('expired_approval', 'a1400000-0000-4000-8000-000000000008'),
  ('reused_approval',  'a1400000-0000-4000-8000-000000000009'),
  ('reconnect_pending','a1400000-0000-4000-8000-000000000010'),
  ('reconnect_new',    'a1400000-0000-4000-8000-000000000011'),
  ('gateway_client',   'c1400000-0000-4000-8000-000000000001'),
  ('manager_session_1','d1400000-0000-4000-8000-000000000001'),
  ('manager_session_2','d1400000-0000-4000-8000-000000000002'),
  ('worker_session',   'd1400000-0000-4000-8000-000000000003');

-- Remote database test runners do not own auth.users, so they must not disable
-- Auth triggers. Borrow two active profiles only inside this rollback transaction.
insert into mcp_v1_ids (name, id)
select 'manager', p.id
from public.profiles p
where p.accepted_at is not null
  and p.deleted_at is null
order by p.created_at, p.id
limit 1;

insert into mcp_v1_ids (name, id)
select 'worker', p.id
from public.profiles p
where p.accepted_at is not null
  and p.deleted_at is null
  and p.id <> (select id from mcp_v1_ids where name = 'manager')
order by p.created_at, p.id
limit 1;

create function pg_temp.mcp_v1_id(label text)
returns uuid
language sql
stable
as $$
  select id from pg_temp.mcp_v1_ids where name = label;
$$;

create function pg_temp.authenticate_as(
  target uuid,
  oauth_client_id text default null,
  oauth_session_id uuid default null
)
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    (
      jsonb_build_object('sub', target, 'role', 'authenticated')
      || case
        when oauth_client_id is null then '{}'::jsonb
        else jsonb_build_object(
          'client_id', oauth_client_id,
          'session_id', oauth_session_id
        )
      end
    )::text,
    true
  );
$$;

create function pg_temp.clear_auth()
returns void
language sql
as $$
  select set_config('request.jwt.claims', '{}', true);
$$;

create function pg_temp.grant_role_permissions(
  target_role_name text,
  permission_keys text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role_id integer;
begin
  select r.id into target_role_id
  from public.roles r
  where r.name = target_role_name;

  insert into public.role_permissions (role_id, permission_id)
  select target_role_id, p.id
  from public.permissions p
  where p.key = any(permission_keys);
end;
$$;

select pg_temp.clear_auth();

insert into public.roles (
  name, assignable_work, protected, hr_grantable
) values
  ('mcp_v1_manager', false, false, false),
  ('mcp_v1_worker', true, false, false);

select pg_temp.grant_role_permissions(
  'mcp_v1_manager',
  array[
    'task.create',
    'task.update',
    'task.archive',
    'task.view_all',
    'submission.review'
  ]
);
select pg_temp.grant_role_permissions(
  'mcp_v1_worker',
  array['submission.create']
);

update public.profiles
set
  role_id = (select id from public.roles where name = 'mcp_v1_manager'),
  department_id = (select id from public.departments where name = 'General')
where id = pg_temp.mcp_v1_id('manager');

update public.profiles
set
  role_id = (select id from public.roles where name = 'mcp_v1_worker'),
  department_id = (select id from public.departments where name = 'General')
where id = pg_temp.mcp_v1_id('worker');

-- Use real Auth rows so session-bound MCP checks exercise the same trusted
-- session_id and oauth_client_id relationship used in production.
insert into auth.oauth_clients (
  id,
  client_secret_hash,
  registration_type,
  redirect_uris,
  grant_types,
  client_name,
  client_type,
  token_endpoint_auth_method
) values (
  pg_temp.mcp_v1_id('gateway_client'),
  'mcp-v1-test-secret-hash',
  'manual',
  'https://mcp-v1.example.test/auth/callback',
  'authorization_code,refresh_token',
  'MCP V1 Test Gateway',
  'confidential',
  'client_secret_basic'
);

insert into auth.sessions (id, user_id, oauth_client_id) values
  (
    pg_temp.mcp_v1_id('manager_session_1'),
    pg_temp.mcp_v1_id('manager'),
    pg_temp.mcp_v1_id('gateway_client')
  ),
  (
    pg_temp.mcp_v1_id('manager_session_2'),
    pg_temp.mcp_v1_id('manager'),
    pg_temp.mcp_v1_id('gateway_client')
  ),
  (
    pg_temp.mcp_v1_id('worker_session'),
    pg_temp.mcp_v1_id('worker'),
    pg_temp.mcp_v1_id('gateway_client')
  );

insert into public.tasks (
  id, title, assigned_to, assigned_by, deadline, status
) values (
  pg_temp.mcp_v1_id('start_task'),
  'MCP V1 start and submit',
  pg_temp.mcp_v1_id('worker'),
  pg_temp.mcp_v1_id('manager'),
  now() + interval '2 days',
  'pending'
);

-- ---------------------------------------------------------------------------
-- Structural security
-- ---------------------------------------------------------------------------

insert into mcp_test_output (line) select ok(
  (select relrowsecurity
   from pg_class
   where oid = 'private.mcp_connections'::regclass),
  'MCP connections have RLS enabled'
);
insert into mcp_test_output (line) select ok(
  (select relrowsecurity
   from pg_class
   where oid = 'private.mcp_approval_intents'::regclass),
  'MCP approvals have RLS enabled'
);
insert into mcp_test_output (line) select ok(
  not has_table_privilege(
    'authenticated',
    'private.operation_requests',
    'SELECT'
  ),
  'authenticated users cannot read private idempotency rows'
);
insert into mcp_test_output (line) select ok(
  not has_function_privilege(
    'authenticated',
    'public.flag_overdue_tasks()',
    'EXECUTE'
  ),
  'authenticated page loads cannot run global overdue maintenance'
);
insert into mcp_test_output (line) select ok(
  exists (
    select 1
    from cron.job
    where jobname = 'meritly-flag-overdue-tasks'
  ),
  'overdue maintenance is scheduled with Cron'
);

-- ---------------------------------------------------------------------------
-- Shared web transactions and idempotency
-- ---------------------------------------------------------------------------

select pg_temp.authenticate_as(pg_temp.mcp_v1_id('manager'));
set local role authenticated;

create temporary table mcp_web_result as
select public.create_task_transaction(
  pg_temp.mcp_v1_id('web_create'),
  jsonb_build_object(
    'title', 'Created through shared transaction',
    'description', 'Web and MCP use this same RPC',
    'assigned_to', pg_temp.mcp_v1_id('worker'),
    'priority', 'high',
    'deadline', (
      select value from mcp_v1_values where name = 'web_deadline'
    )
  )
) as result;

insert into mcp_test_output (line) select is(
  (
    select count(*)
    from public.tasks t
    where t.id = (
      select (result->>'task_id')::uuid from mcp_web_result
    )
  ),
  1::bigint,
  'shared create transaction creates exactly one task'
);

insert into mcp_test_output (line) select is(
  public.create_task_transaction(
    pg_temp.mcp_v1_id('web_create'),
    jsonb_build_object(
      'title', 'Created through shared transaction',
      'description', 'Web and MCP use this same RPC',
      'assigned_to', pg_temp.mcp_v1_id('worker'),
      'priority', 'high',
      'deadline', (
        select value from mcp_v1_values where name = 'web_deadline'
      )
    )
  )->>'task_id',
  (select result->>'task_id' from mcp_web_result),
  'same request id and payload returns the recorded result'
);

insert into mcp_test_output (line) select throws_ok(
  format(
    $sql$
      select public.create_task_transaction(
        %L,
        jsonb_build_object(
          'title', 'Changed payload',
          'assigned_to', %L,
          'priority', 'low',
          'deadline', (now() + interval '4 days')::text
        )
      )
    $sql$,
    pg_temp.mcp_v1_id('web_create'),
    pg_temp.mcp_v1_id('worker')
  ),
  'P0001',
  'request id was already used with different input',
  'reusing a request id with changed input is rejected'
);

reset role;
select pg_temp.authenticate_as(pg_temp.mcp_v1_id('worker'));
set local role authenticated;

insert into mcp_test_output (line) select lives_ok(
  format(
    $sql$
      select public.start_task_transaction(
        %L,
        jsonb_build_object('task_id', %L)
      )
    $sql$,
    pg_temp.mcp_v1_id('worker_start'),
    pg_temp.mcp_v1_id('start_task')
  ),
  'employee starts their task through the shared transaction'
);

create temporary table mcp_submit_result as
select public.submit_work_transaction(
  pg_temp.mcp_v1_id('worker_submit'),
  jsonb_build_object(
    'task_id', pg_temp.mcp_v1_id('start_task'),
    'note', 'Atomic submission evidence'
  )
) as result;

insert into mcp_test_output (line) select is(
  (
    select t.status
    from public.tasks t
    where t.id = pg_temp.mcp_v1_id('start_task')
  ),
  'submitted',
  'submit transaction advances the task atomically'
);
insert into mcp_test_output (line) select is(
  (
    select count(*)
    from public.submissions s
    where s.id = (
      select (result->>'submission_id')::uuid from mcp_submit_result
    )
  ),
  1::bigint,
  'submit transaction creates one immutable submission'
);

reset role;
select pg_temp.authenticate_as(pg_temp.mcp_v1_id('manager'));
set local role authenticated;

insert into mcp_test_output (line) select lives_ok(
  format(
    $sql$
      select public.review_submission_transaction(
        %L,
        jsonb_build_object(
          'task_id', %L,
          'submission_id', %L,
          'decision', 'completed',
          'feedback', 'Reviewed atomically'
        )
      )
    $sql$,
    pg_temp.mcp_v1_id('manager_review'),
    pg_temp.mcp_v1_id('start_task'),
    (select (result->>'submission_id')::uuid from mcp_submit_result)
  ),
  'review transaction updates feedback and task status together'
);

insert into mcp_test_output (line) select is(
  (
    select t.status
    from public.tasks t
    where t.id = pg_temp.mcp_v1_id('start_task')
  ),
  'completed',
  'review transaction records the final task status'
);

-- ---------------------------------------------------------------------------
-- MCP connection, approval, consumption, and revocation
-- ---------------------------------------------------------------------------

reset role;
select pg_temp.authenticate_as(
  pg_temp.mcp_v1_id('manager'),
  pg_temp.mcp_v1_id('gateway_client')::text,
  pg_temp.mcp_v1_id('manager_session_1')
);
set local role authenticated;

create temporary table mcp_connection_result as
select public.mcp_touch_connection(
  repeat('a', 64),
  'MCP V1 Test Client',
  'https://client.example.test'
) as connection_id;

create temporary table mcp_approval_result as
select *
from public.mcp_prepare_write(
  repeat('a', 64),
  'MCP V1 Test Client',
  'https://client.example.test',
  'create_task',
  pg_temp.mcp_v1_id('mcp_create'),
  null,
  jsonb_build_object(
    'title', 'MCP approved task',
    'assigned_to', pg_temp.mcp_v1_id('worker'),
    'priority', 'medium',
    'deadline', (
      select value from mcp_v1_values where name = 'mcp_deadline'
    )
  )
);

insert into mcp_test_output (line) select is(
  (select state from mcp_approval_result),
  'pending',
  'MCP write starts as a pending five-minute approval'
);

insert into mcp_test_output (line) select throws_ok(
  format(
    $$
      select public.mcp_approve_write(
        repeat('b', 64),
        %L
      )
    $$,
    (select approval_token from mcp_approval_result)
  ),
  'P0001',
  'MCP connection not found or revoked',
  'a different MCP connection cannot approve the intent'
);

insert into mcp_test_output (line) select throws_ok(
  format(
    $sql$
      select * from public.mcp_prepare_write(
        repeat('a', 64),
        'MCP V1 Test Client',
        'https://client.example.test',
        'create_task',
        %L,
        null,
        jsonb_build_object(
          'title', 'Changed after preview',
          'assigned_to', %L,
          'priority', 'low',
          'deadline', (
            select value from mcp_v1_values where name = 'mcp_deadline'
          )
        )
      )
    $sql$,
    pg_temp.mcp_v1_id('mcp_create'),
    pg_temp.mcp_v1_id('worker')
  ),
  'P0001',
  'request id was already used with different input',
  'changed payload cannot reuse a pending approval request'
);

create temporary table mcp_expired_approval as
select *
from public.mcp_prepare_write(
  repeat('a', 64),
  'MCP V1 Test Client',
  'https://client.example.test',
  'create_task',
  pg_temp.mcp_v1_id('expired_approval'),
  null,
  jsonb_build_object(
    'title', 'Expired approval fixture',
    'assigned_to', pg_temp.mcp_v1_id('worker'),
    'priority', 'low',
    'deadline', (
      select value from mcp_v1_values where name = 'mcp_deadline'
    )
  )
);

reset role;
update private.mcp_approval_intents
set expires_at = now() - interval '1 second'
where approval_token = (select approval_token from mcp_expired_approval);
set local role authenticated;

insert into mcp_test_output (line) select throws_ok(
  format(
    $$
      select public.mcp_approve_write(
        repeat('a', 64),
        %L
      )
    $$,
    (select approval_token from mcp_expired_approval)
  ),
  'P0001',
  'approval is missing, expired, or already decided',
  'expired approval cannot be accepted'
);

reset role;
select pg_temp.authenticate_as(
  pg_temp.mcp_v1_id('worker'),
  pg_temp.mcp_v1_id('gateway_client')::text,
  pg_temp.mcp_v1_id('worker_session')
);
set local role authenticated;

insert into mcp_test_output (line) select is(
  (
    select count(*)
    from public.get_mcp_approval(
      (select approval_token from mcp_approval_result)
    )
  ),
  0::bigint,
  'another user cannot read the approval preview'
);

reset role;
select pg_temp.authenticate_as(
  pg_temp.mcp_v1_id('manager'),
  pg_temp.mcp_v1_id('gateway_client')::text,
  pg_temp.mcp_v1_id('manager_session_1')
);
set local role authenticated;

insert into mcp_test_output (line) select throws_ok(
  format(
    $sql$
      select public.create_task_transaction(
        %L,
        jsonb_build_object(
          'title', 'Unapproved MCP task',
          'assigned_to', %L,
          'priority', 'medium',
          'deadline', (
            select value from mcp_v1_values where name = 'mcp_deadline'
          )
        ),
        repeat('a', 64),
        null
      )
    $sql$,
    pg_temp.mcp_v1_id('no_approval'),
    pg_temp.mcp_v1_id('worker')
  ),
  'P0001',
  'MCP approval is required',
  'MCP writes cannot execute without an approved intent'
);

insert into mcp_test_output (line) select ok(
  public.mcp_approve_write(
    repeat('a', 64),
    (select approval_token from mcp_approval_result)
  ),
  'MCP elicitation can approve the exact pending intent'
);

insert into mcp_test_output (line) select lives_ok(
  format(
    $sql$
      select public.create_task_transaction(
        %L,
        jsonb_build_object(
          'title', 'MCP approved task',
          'assigned_to', %L,
          'priority', 'medium',
          'deadline', (
            select value from mcp_v1_values where name = 'mcp_deadline'
          )
        ),
        repeat('a', 64),
        %L
      )
    $sql$,
    pg_temp.mcp_v1_id('mcp_create'),
    pg_temp.mcp_v1_id('worker'),
    (select approval_token from mcp_approval_result)
  ),
  'approved MCP write consumes the exact intent and succeeds'
);

reset role;

insert into mcp_test_output (line) select is(
  (
    select state
    from private.mcp_approval_intents
    where approval_token = (
      select approval_token from mcp_approval_result
    )
  ),
  'consumed',
  'successful MCP mutation consumes approval once'
);

set local role authenticated;

insert into mcp_test_output (line) select throws_ok(
  format(
    $sql$
      select public.create_task_transaction(
        %L,
        jsonb_build_object(
          'title', 'Reused approval task',
          'assigned_to', %L,
          'priority', 'low',
          'deadline', (
            select value from mcp_v1_values where name = 'mcp_deadline'
          )
        ),
        repeat('a', 64),
        %L
      )
    $sql$,
    pg_temp.mcp_v1_id('reused_approval'),
    pg_temp.mcp_v1_id('worker'),
    (select approval_token from mcp_approval_result)
  ),
  'P0001',
  'approval is missing, expired, changed, or already used',
  'consumed approval cannot authorize a different write'
);

-- ---------------------------------------------------------------------------
-- One-time browser upload bridge
-- ---------------------------------------------------------------------------

create temporary table mcp_oversized_upload as
select *
from public.mcp_prepare_upload(
  repeat('a', 64),
  'MCP V1 Test Client',
  'https://client.example.test',
  'task_attachment',
  null
);

insert into mcp_test_output (line) select throws_ok(
  format(
    $sql$
      select public.mcp_complete_upload(
        %L,
        %L,
        'oversized.pdf',
        'application/pdf',
        10485761
      )
    $sql$,
    (select upload_token from mcp_oversized_upload),
    pg_temp.mcp_v1_id('manager')::text
      || '/'
      || (select upload_token::text from mcp_oversized_upload)
      || '/oversized.pdf'
  ),
  'P0001',
  'file size must be between 1 byte and 10 MB',
  'browser finalization rejects files over 10 MB'
);

create temporary table mcp_expired_upload as
select *
from public.mcp_prepare_upload(
  repeat('a', 64),
  'MCP V1 Test Client',
  'https://client.example.test',
  'task_attachment',
  null
);

reset role;
update private.mcp_upload_sessions
set expires_at = now() - interval '1 second'
where upload_token = (select upload_token from mcp_expired_upload);
set local role authenticated;

insert into mcp_test_output (line) select throws_ok(
  format(
    $sql$
      select public.mcp_complete_upload(
        %L,
        %L,
        'expired.pdf',
        'application/pdf',
        25
      )
    $sql$,
    (select upload_token from mcp_expired_upload),
    pg_temp.mcp_v1_id('manager')::text
      || '/'
      || (select upload_token::text from mcp_expired_upload)
      || '/expired.pdf'
  ),
  'P0001',
  'upload session is unavailable or expired',
  'expired upload cannot be finalized'
);

create temporary table mcp_upload_result as
select *
from public.mcp_prepare_upload(
  repeat('a', 64),
  'MCP V1 Test Client',
  'https://client.example.test',
  'task_attachment',
  null
);

insert into mcp_test_output (line) select is(
  (select state from mcp_upload_result),
  'pending',
  'file bridge creates a pending connection-bound upload'
);

insert into mcp_test_output (line) select lives_ok(
  format(
    $sql$
      insert into storage.objects (bucket_id, name)
      values ('task-attachments', %L)
    $sql$,
    pg_temp.mcp_v1_id('manager')::text
      || '/'
      || (select upload_token::text from mcp_upload_result)
      || '/test.pdf'
  ),
  'browser bridge stores the object only in the actor upload folder'
);

insert into mcp_test_output (line) select throws_ok(
  format(
    $sql$
      select public.mcp_complete_upload(
        %L,
        %L,
        'test.pdf',
        'application/pdf',
        25
      )
    $sql$,
    (select upload_token from mcp_upload_result),
    pg_temp.mcp_v1_id('worker')::text
      || '/'
      || (select upload_token::text from mcp_upload_result)
      || '/test.pdf'
  ),
  'P0001',
  'invalid upload path',
  'browser finalization rejects a cross-user object path'
);

insert into mcp_test_output (line) select ok(
  public.mcp_complete_upload(
    (select upload_token from mcp_upload_result),
    pg_temp.mcp_v1_id('manager')::text
      || '/'
      || (select upload_token::text from mcp_upload_result)
      || '/test.pdf',
    'test.pdf',
    'application/pdf',
    25
  ),
  'browser finalization verifies and records the private object'
);

insert into mcp_test_output (line) select throws_ok(
  format(
    $sql$
      select public.mcp_complete_upload(
        %L,
        %L,
        'test.pdf',
        'application/pdf',
        25
      )
    $sql$,
    (select upload_token from mcp_upload_result),
    pg_temp.mcp_v1_id('manager')::text
      || '/'
      || (select upload_token::text from mcp_upload_result)
      || '/test.pdf'
  ),
  'P0001',
  'upload session is unavailable or expired',
  'one upload token cannot be finalized twice'
);

insert into mcp_test_output (line) select is(
  (
    select state
    from public.get_mcp_upload(
      (select upload_token from mcp_upload_result)
    )
  ),
  'uploaded',
  'uploaded file waits for one matching business transaction'
);

insert into mcp_test_output (line) select throws_ok(
  format(
    $$
      select * from public.mcp_resolve_upload(
        repeat('b', 64),
        %L,
        'task_attachment',
        null
      )
    $$,
    (select upload_token from mcp_upload_result)
  ),
  'P0001',
  'MCP connection not found or revoked',
  'a different MCP connection cannot resolve the upload'
);

insert into mcp_test_output (line) select throws_ok(
  format(
    $$
      select * from public.mcp_resolve_upload(
        repeat('a', 64),
        %L,
        'submission',
        %L
      )
    $$,
    (select upload_token from mcp_upload_result),
    pg_temp.mcp_v1_id('start_task')
  ),
  'P0001',
  'upload session is unavailable or expired',
  'upload purpose and target task must match exactly'
);

reset role;
select pg_temp.authenticate_as(
  pg_temp.mcp_v1_id('worker'),
  pg_temp.mcp_v1_id('gateway_client')::text,
  pg_temp.mcp_v1_id('worker_session')
);
set local role authenticated;

insert into mcp_test_output (line) select is(
  (
    select count(*)
    from public.get_mcp_upload(
      (select upload_token from mcp_upload_result)
    )
  ),
  0::bigint,
  'another user cannot inspect the upload session'
);

reset role;
select pg_temp.authenticate_as(
  pg_temp.mcp_v1_id('manager'),
  pg_temp.mcp_v1_id('gateway_client')::text,
  pg_temp.mcp_v1_id('manager_session_1')
);
set local role authenticated;

create temporary table mcp_upload_approval as
select *
from public.mcp_prepare_write(
  repeat('a', 64),
  'MCP V1 Test Client',
  'https://client.example.test',
  'create_task',
  pg_temp.mcp_v1_id('upload_create'),
  null,
  jsonb_build_object(
    'title', 'MCP task with upload',
    'assigned_to', pg_temp.mcp_v1_id('worker'),
    'priority', 'low',
    'deadline', (
      select value from mcp_v1_values where name = 'mcp_deadline'
    ),
    'attachment_path',
      pg_temp.mcp_v1_id('manager')::text
        || '/'
        || (select upload_token::text from mcp_upload_result)
        || '/test.pdf',
    'attachment_name', 'test.pdf'
  )
);

select public.mcp_approve_write(
  repeat('a', 64),
  (select approval_token from mcp_upload_approval)
);

insert into mcp_test_output (line) select lives_ok(
  format(
    $sql$
      select public.create_task_transaction(
        %L,
        jsonb_build_object(
          'title', 'MCP task with upload',
          'assigned_to', %L,
          'priority', 'low',
          'deadline', (
            select value from mcp_v1_values where name = 'mcp_deadline'
          ),
          'attachment_path', %L,
          'attachment_name', 'test.pdf'
        ),
        repeat('a', 64),
        %L
      )
    $sql$,
    pg_temp.mcp_v1_id('upload_create'),
    pg_temp.mcp_v1_id('worker'),
    pg_temp.mcp_v1_id('manager')::text
      || '/'
      || (select upload_token::text from mcp_upload_result)
      || '/test.pdf',
    (select approval_token from mcp_upload_approval)
  ),
  'approved write atomically attaches and consumes the uploaded file'
);

reset role;
insert into mcp_test_output (line) select is(
  (
    select state
    from private.mcp_upload_sessions
    where upload_token = (select upload_token from mcp_upload_result)
  ),
  'consumed',
  'successful business write consumes the upload exactly once'
);
set local role authenticated;

create temporary table mcp_secondary_connection as
select public.mcp_touch_connection(
  repeat('b', 64),
  'ChatGPT',
  'https://chatgpt.example.test'
) as connection_id;

create temporary table mcp_pending_at_revoke as
select *
from public.mcp_prepare_write(
  repeat('a', 64),
  'MCP V1 Test Client',
  'https://client.example.test',
  'create_task',
  pg_temp.mcp_v1_id('reconnect_pending'),
  null,
  jsonb_build_object(
    'title', 'Approval invalidated by revoke',
    'assigned_to', pg_temp.mcp_v1_id('worker'),
    'priority', 'low',
    'deadline', (
      select value from mcp_v1_values where name = 'mcp_deadline'
    )
  )
);

create temporary table mcp_upload_at_revoke as
select *
from public.mcp_prepare_upload(
  repeat('a', 64),
  'MCP V1 Test Client',
  'https://client.example.test',
  'task_attachment',
  null
);

insert into mcp_test_output (line) select ok(
  public.revoke_mcp_connection(
    (select connection_id from mcp_connection_result)
  ),
  'user can revoke one MCP connection'
);

insert into mcp_test_output (line) select is(
  (
    select count(*)
    from public.list_mcp_connections()
  ),
  1::bigint,
  'connection listing hides revoked records and keeps other apps active'
);

insert into mcp_test_output (line) select is(
  (
    select client_name
    from public.list_mcp_connections()
  ),
  'ChatGPT',
  'revoking Claude does not revoke another downstream app'
);

reset role;
insert into mcp_test_output (line) select is(
  (
    select state
    from private.mcp_approval_intents
    where approval_token = (
      select approval_token from mcp_pending_at_revoke
    )
  ),
  'denied',
  'revoking a connection denies its unconsumed approval'
);
insert into mcp_test_output (line) select is(
  (
    select state
    from private.mcp_upload_sessions
    where upload_token = (select upload_token from mcp_upload_at_revoke)
  ),
  'expired',
  'revoking a connection expires its incomplete upload'
);
set local role authenticated;

insert into mcp_test_output (line) select throws_ok(
  $$
    select public.mcp_touch_connection(
      repeat('a', 64),
      'MCP V1 Test Client',
      'https://client.example.test'
    )
  $$,
  'P0001',
  'this MCP connection has been revoked',
  'revoked connection cannot silently reactivate'
);

reset role;
select pg_temp.authenticate_as(
  pg_temp.mcp_v1_id('manager'),
  pg_temp.mcp_v1_id('gateway_client')::text,
  pg_temp.mcp_v1_id('manager_session_2')
);
set local role authenticated;

create temporary table mcp_reconnected as
select public.mcp_touch_connection(
  repeat('a', 64),
  'MCP V1 Test Client',
  'https://client.example.test'
) as connection_id;

insert into mcp_test_output (line) select isnt(
  (select connection_id from mcp_reconnected),
  (select connection_id from mcp_connection_result),
  'fresh OAuth session creates a new active connection record'
);

insert into mcp_test_output (line) select is(
  public.mcp_touch_connection(
    repeat('a', 64),
    'MCP V1 Test Client',
    'https://client.example.test'
  ),
  (select connection_id from mcp_reconnected),
  'repeated calls in one OAuth session reuse the same connection'
);

insert into mcp_test_output (line) select is(
  (
    select count(*)
    from public.list_mcp_connections() c
    where c.client_name = 'MCP V1 Test Client'
  ),
  1::bigint,
  'only one Claude authorization can be active at a time'
);

create temporary table mcp_reconnect_approval as
select *
from public.mcp_prepare_write(
  repeat('a', 64),
  'MCP V1 Test Client',
  'https://client.example.test',
  'create_task',
  pg_temp.mcp_v1_id('reconnect_new'),
  null,
  jsonb_build_object(
    'title', 'Fresh reconnect approval',
    'assigned_to', pg_temp.mcp_v1_id('worker'),
    'priority', 'low',
    'deadline', (
      select value from mcp_v1_values where name = 'mcp_deadline'
    )
  )
);

reset role;
select pg_temp.authenticate_as(
  pg_temp.mcp_v1_id('manager'),
  pg_temp.mcp_v1_id('gateway_client')::text,
  pg_temp.mcp_v1_id('manager_session_1')
);
set local role authenticated;

insert into mcp_test_output (line) select throws_ok(
  $$
    select public.mcp_touch_connection(
      repeat('a', 64),
      'MCP V1 Test Client',
      'https://client.example.test'
    )
  $$,
  'P0001',
  'this MCP connection has been revoked',
  'superseded OAuth session remains permanently blocked'
);

insert into mcp_test_output (line) select throws_ok(
  format(
    $$
      select public.mcp_approve_write(repeat('a', 64), %L)
    $$,
    (select approval_token from mcp_reconnect_approval)
  ),
  'P0001',
  'MCP connection not found or revoked',
  'old OAuth session cannot approve work for the replacement connection'
);

reset role;
select pg_temp.authenticate_as(
  pg_temp.mcp_v1_id('manager'),
  pg_temp.mcp_v1_id('gateway_client')::text,
  null
);
set local role authenticated;

insert into mcp_test_output (line) select throws_ok(
  $$
    select public.mcp_touch_connection(
      repeat('c', 64),
      'Missing Session Client',
      null
    )
  $$,
  'P0001',
  'an active OAuth session is required',
  'OAuth client token without session_id is rejected'
);

reset role;
select pg_temp.authenticate_as(
  pg_temp.mcp_v1_id('manager'),
  pg_temp.mcp_v1_id('gateway_client')::text,
  pg_temp.mcp_v1_id('worker_session')
);
set local role authenticated;

insert into mcp_test_output (line) select throws_ok(
  $$
    select public.mcp_touch_connection(
      repeat('c', 64),
      'Wrong Session Client',
      null
    )
  $$,
  'P0001',
  'OAuth session is no longer active',
  'OAuth session belonging to another user is rejected'
);

reset role;
select pg_temp.clear_auth();

insert into mcp_test_output (line) select * from finish();
select line from mcp_test_output order by sequence;
rollback;
