# Feature 13 — Production-Grade Departmental Scope

> **Status:** Final implementation plan after reviewing the current application,
> live database definitions, Feature 11 RBAC, Feature 12 offboarding/history, and
> Supabase RLS/Auth/Storage guidance.
>
> **Core outcome:** HR and other scoped managers can only see and manage people
> and work belonging to their own department. A `user.manage_all` holder remains
> global. The database is the security boundary; frontend filtering is only UX.

---

## 0. Decisions locked for this version

1. Every profile, including admin, has a non-NULL department.
   `user.manage_all`—not a NULL department—provides global access.
2. When a user moves departments, all of that user's current and historical work
   becomes visible to the new department and disappears from the old department.
3. Basic company-directory information is global: active users may read names,
   roles, and department labels. Emails, work, ratings, performance, and
   management actions remain scoped.
4. Roles and permissions remain global configuration.
5. Departments can be created and renamed, but not deleted in Feature 13.
6. Both sensitive work-file buckets, `submissions` and `task-attachments`, become
   private. Downloads use short-lived signed URLs after a fresh authorization
   check.
7. Feature 10 is not a prerequisite. Features 11 and 12 are required and already
   implemented.
8. Work stays on the current `main` branch unless the developer explicitly asks
   for another branch.

---

## 1. Current state verified before planning

- `profiles` has no department column.
- No `departments` table exists.
- Feature 11 permission rules are live.
- Feature 12 offboarding, audit tables, historical employee picker, and custody
  queue are live.
- `admin_list_users()` currently allows:
  `user.manage_all`, `user.invite`, `user.promote`, `user.archive`, or
  `stats.view_all`.
- `assignable_employees()` currently allows `task.create OR task.update`.
- `historical_employees()` and `can_view_performance_subject()` are SECURITY
  INVOKER functions and currently have no department predicate.
- Submission and task-attachment buckets are public.
- Live data currently includes existing task attachments and submission files,
  so file migration must preserve old objects.
- The current protection triggers explicitly reference:
  `tasks.attachment_url` and `submissions.file_url`.

The implementation must preserve all of these working Feature 11/12 behaviors
while adding department isolation.

---

## 2. Security model

### 2.1 Department ownership

Add:

```text
departments
  id
  name
  created_at
  updated_at

profiles.department_id -> departments.id
```

Department names:

- are trimmed;
- must be 2–80 characters;
- are case-insensitively unique;
- cannot be blank;
- cannot be deleted through the application API.

Create `General`, backfill every existing profile into it, verify the backfill,
then make `profiles.department_id` NOT NULL.

### 2.2 Central access rule

Create a non-exposed helper in a `private` schema:

```text
private.can_access_user(target_user_id)
```

It returns true when:

- the caller is active and has `user.manage_all`; or
- the caller and target have the same non-NULL department.

The helper:

- is `STABLE SECURITY DEFINER`;
- uses `search_path = ''`;
- reads profiles by primary key;
- always derives the caller from `auth.uid()`;
- is not exposed as a public Data API RPC;
- receives only the minimum privileges required for RLS evaluation.

The performance page will not call this private helper directly. Public
application RPCs will apply the same rule internally.

### 2.3 Restrictive RLS layer

Keep every existing permissive Feature 11/12 policy. Add department isolation as
`AS RESTRICTIVE` policies, so access requires:

```text
existing permission/ownership rule
AND
same department or global manager
```

Add restrictive policies to:

| Object | Commands | Department owner |
|---|---|---|
| `tasks` | SELECT, INSERT, UPDATE | `assigned_to` |
| `submissions` | SELECT, INSERT, UPDATE | `employee_id` |
| `ratings` | SELECT, INSERT | `employee_id` |
| `activity_log` | SELECT | `employee_id` |
| `profiles` | UPDATE | profile `id` |
| `user_lifecycle_events` | SELECT | `target_user_id` |
| `task_assignment_history` | SELECT | `from_user_id` or `to_user_id` |
| `user_department_history` | SELECT | `target_user_id` |

Do not add permissive write policies where no write is currently allowed.
Restrictive policies must never accidentally grant a new operation.

Every policy must:

- use `TO authenticated`;
- include both `USING` and `WITH CHECK` for UPDATE;
- preserve employee self-access through the same-department rule;
- fail closed for archived callers because `has_permission()` and base policies
  already require an active profile;
- use indexed foreign-key/lookup columns;
- wrap constant `auth.uid()` and permission calls in `SELECT` where safe.

### 2.4 Deliberately global profile directory

`profiles SELECT` remains global for active users. This keeps assignee/rater name
lookups working and implements the selected company-directory rule.

This means active authenticated users may enumerate:

- full name;
- role;
- department membership.

They may not obtain cross-department emails or work data through the scoped RPCs
and RLS policies.

---

## 3. Database objects and permissions

### 3.1 Departments

Create `public.departments` with RLS.

Policies and grants:

- active authenticated users: SELECT;
- `department.manage`: INSERT and UPDATE;
- no authenticated DELETE privilege or DELETE policy;
- explicit sequence `USAGE` for authenticated department creation;
- no grants to `anon` or `PUBLIC`.

Add permission:

```text
department.manage
```

Seed it only to the protected admin role. The Roles page may later grant it to a
custom role because the project is capability-based. Moving users still requires
`user.manage_all`, not merely `department.manage`.

### 3.2 Department transfer audit

Create append-only `public.user_department_history`:

```text
id
request_id unique
target_user_id
actor_id
from_department_id
to_department_id
reason
created_at
```

Rules:

- authenticated users receive SELECT only;
- no direct authenticated INSERT/UPDATE/DELETE;
- a trigger records every profile department change;
- mutation-protection trigger rejects UPDATE/DELETE even for accidental
  privileged writes;
- foreign keys and query columns are indexed;
- history follows the target user's current department, matching the selected
  "history moves with the user" rule.

### 3.3 Transactional department transfer RPC

Create:

```text
move_user_department(
  request_id,
  target_user_id,
  new_department_id,
  reason
)
```

Behavior:

1. Require authenticated active caller with `user.manage_all`.
2. Require a UUID request ID for idempotent retries.
3. Require a reason between 3 and 500 characters.
4. Reject self-targeting from this management flow.
5. Validate the target profile and destination department.
6. Lock the target profile `FOR UPDATE`.
7. Reject a no-op move to the same department.
8. Set transaction-local audit context.
9. Update the profile once.
10. Let the audit trigger insert the immutable history row.
11. Return the existing result for a repeated request ID.

The profile row lock serializes department transfer against Feature 12's
task-assignee validation lock. If a task assignment and a department transfer
happen concurrently, one completes before the other and the second operation
re-evaluates the latest department scope.

### 3.4 Direct department mutation guard

Add an independent profile trigger:

- non-`user.manage_all` callers cannot change `department_id`;
- NULL department values are rejected by the schema;
- service/direct SQL provisioning remains possible;
- direct privileged updates are still audited with a safe default reason;
- it does not rewrite Feature 11's `protect_profile_columns` or Feature 12's
  lifecycle triggers.

---

## 4. Trusted invite provisioning

### 4.1 Problem being prevented

Supabase invite `data` is stored in `raw_user_meta_data`, which is user-editable.
The department ID itself must therefore never be trusted from user metadata as
authorization input.

### 4.2 One-time provisioning record

Create a private pending-provisioning table containing:

```text
token
normalized_email
full_name
department_id
created_by
expires_at
created_at
```

Security:

- no `anon`, `authenticated`, or `PUBLIC` table access;
- token is random, one-time, short-lived, and indexed;
- normalized email must also match the new Auth user's email;
- expired rows are ignored and cleaned opportunistically;
- successful profile creation consumes the row in the same Auth transaction.

Expose only service-role-only provisioning helpers needed by the API route.
Revoke default `PUBLIC` execution and explicitly grant only `service_role`.

### 4.3 Invite route

Change `POST /api/invite-user` input to:

```ts
{
  email: string;
  fullName: string;
  departmentId: number;
}
```

Server behavior:

1. Validate email, name, and numeric department ID.
2. Authenticate the caller with the session client.
3. Require `user.invite`.
4. Read the caller's department and `user.manage_all` capability server-side.
5. Global manager: use the selected valid department.
6. Scoped HR: ignore the submitted department and force the HR's own department.
7. Create a one-time provisioning record with the service client.
8. Call `inviteUserByEmail()` with only the opaque token in metadata.
9. If the Auth invite fails, invalidate the pending record.
10. Never return the token or service-role information to the browser.

### 4.4 Auth profile trigger

Update `handle_new_user()` so it:

1. Reads the opaque provisioning token.
2. Locks and validates the pending row.
3. Matches normalized email.
4. Rejects missing, invalid, expired, or already-used tokens.
5. Inserts employee profile using the trusted pending row's name and department.
6. Deletes/consumes the pending record.

The department is never read directly from editable metadata.

### 4.5 Compatibility rollout

To avoid breaking the currently deployed invite form between migration and code
deployment:

1. First trigger version supports a temporary legacy fallback to `General` when
   no token is supplied.
2. Deploy and verify the new token-based invite route.
3. Apply a follow-up enforcement migration that removes the fallback and requires
   a valid token.

After enforcement, invitations created directly from the Supabase Dashboard
without the application provisioning flow will fail intentionally. Use the
Meritly Users page for all new invitations.

Feature 11/12 database test fixtures that insert `auth.users` must create matching
test provisioning tokens first.

---

## 5. Existing RPCs that must be re-layered

Base every definition on the current live function. Do not copy older plan
versions that drop permissions.

### `admin_list_users()`

Preserve entry when the caller has any of:

```text
user.manage_all
user.invite
user.promote
user.archive
stats.view_all
```

Return:

```text
id, full_name, role, email, deleted_at, accepted,
department_id, department_name
```

Filtering:

- global manager: all non-self users;
- scoped manager: assignable users in the caller's department only.

### `assignable_employees()`

Preserve:

```text
task.create OR task.update
```

Return active, accepted, assignable workers:

- all departments for `user.manage_all`;
- caller's department otherwise.

### `historical_employees()`

Preserve `stats.view_all` and SECURITY INVOKER behavior. Filter both current
workers and historical IDs through the department access rule. This closes the
Feature 12 history leak that would otherwise expose another department's people.

### `can_view_performance_subject(target)`

Return true only when:

- employee is requesting self and remains active; or
- caller has `stats.view_all`;
- target is a valid current/historical performance subject;
- caller may access the target's department.

The Performance page uses only this scoped public RPC and redirects unauthorized
cross-department targets to `/dashboard/employees`.

### `offboarding_queue()` and `offboard_user()`

Keep both SECURITY INVOKER. Their task/profile queries and writes automatically
obey the new restrictive policies.

Consequences:

- HR can offboard only same-department workers;
- HR replacement choices are same-department only;
- crafted cross-department replacement requests fail at RLS;
- admin may transfer work across departments;
- submitted work stays attributed to the original employee as Feature 12 already
  requires.

---

## 6. Frontend behavior

### 6.1 Departments page

Create `/dashboard/departments` using the existing Server Component + Client
Component pattern.

- Server guard: `department.manage`.
- List departments and user counts.
- Create department.
- Rename department.
- No delete button.
- Handle duplicate/blank/too-long names with friendly errors.
- Sidebar link appears only for `department.manage`.

### 6.2 Users page

Add:

- Department column.
- Admin invite department picker.
- Scoped HR read-only department label in the invite form.
- Admin-only “Move department” action.
- Transfer confirmation with destination, reason, and idempotent request ID.
- Refresh user, replacement, and employee lists after a successful move.

Never perform a raw browser `profiles.department_id` update from this screen.
Always use `move_user_department()`.

### 6.3 Employees and performance

- Employee cards show department.
- Existing Active/All/Archived/Promoted filters stay unchanged.
- Counts remain correct because task RLS is department-scoped.
- Performance page redirects a cross-department `?emp=` target.
- Employee self-performance behavior remains unchanged.

### 6.4 Task and offboarding screens

No client-side department filtering is the security boundary.

- Task lists are scoped by task RLS.
- Assignee and replacement dropdowns use scoped RPCs.
- Submission review queries use submission RLS.
- Custody queue uses scoped task RLS.

The UI may show an empty state when no same-department worker is available.

---

## 7. Private file storage without downtime

### 7.1 Why both buckets are included

Department RLS would hide database rows, but a public Storage URL bypasses
download authorization. Both submission evidence and task instructions are work
data, so both buckets must become private for complete isolation.

### 7.2 Additive path migration

Do not immediately rename or drop existing URL columns.

First add:

```text
submissions.file_path
tasks.attachment_path
```

Then:

1. Parse candidate paths from legacy public URLs.
2. Match every candidate against `storage.objects`.
3. Compare mapped counts with all non-NULL legacy URL counts.
4. Abort the migration if any existing object cannot be mapped.
5. Keep legacy columns until private download has been verified in production.

Recreate:

- `protect_submission_columns()` to freeze `file_path` as evidence;
- `protect_task_columns()` to protect `attachment_path`;
- all function execution revokes from the current hardened definitions.

Failing to update these triggers would make later task/submission writes crash
because the current trigger bodies explicitly reference legacy column names.

### 7.3 New upload behavior

- New uploads store only the object path in the new path column.
- Uploads remain collision-resistant and `upsert: false`.
- Existing MIME and size limits remain.
- Existing capability/folder upload policies remain.
- A file object is not downloadable unless an RLS-visible task/submission row
  references its exact path.

If upload succeeds but the following database write fails:

- the client calls a server cleanup endpoint;
- the endpoint re-authenticates the caller;
- it deletes only a caller-owned object that is not referenced by a task or
  submission;
- failed cleanup is logged;
- unreferenced objects remain non-downloadable, so this is a storage-cleanliness
  issue rather than a data leak.

### 7.4 Storage SELECT policies

For private downloads:

- submission object SELECT requires an RLS-visible submission whose
  `file_path = storage.objects.name`;
- task-attachment object SELECT requires an RLS-visible task whose
  `attachment_path = storage.objects.name`;
- no folder-name-only manager access;
- employee own access continues through the underlying task/submission policy;
- cross-department path guessing returns no object.

### 7.5 On-demand download flow

Do not generate ten-minute links at page render.

Use authenticated download endpoints:

1. User clicks Download.
2. Server re-authenticates the session.
3. Server queries the task/submission using the user's RLS-bound client.
4. Missing or invisible row returns 404, not information about another
   department.
5. Server creates a signed URL valid for approximately 60 seconds.
6. Server redirects to that URL.

This minimizes the stale-access window after archive or department transfer.
Signed URLs already issued cannot be revoked individually, so they must be
short-lived.

### 7.6 Staged private-bucket rollout

Use this exact order:

1. Add path columns, backfill, triggers, policies, and download endpoints while
   buckets remain public.
2. Deploy dual-compatible application code:
   new records use paths; legacy records can still display during verification.
3. Verify every existing file through the authenticated download flow.
4. Flip both buckets to private.
5. Confirm old public URLs fail.
6. Confirm authorized downloads work and cross-department downloads fail.
7. Only in a later cleanup migration remove legacy URL columns and dual-read
   code.

If the private flip has an unexpected issue, restore bucket visibility only as a
short emergency rollback while fixing the signed-download path; record that this
temporarily restores public-link exposure.

---

## 8. Public interfaces and generated types

Regenerate `src/lib/database.types.ts` after the live schema is final.

Update shared types:

```text
DepartmentRow
UserRow + department_id + department_name
HistoricalEmployee + department_id + department_name
EmployeeSummary + department_name
Task attachment path/download fields
Submission file path/download fields
Department transfer result
```

Separate persisted paths from temporary browser links:

```text
attachment_path / file_path   -> stored in database
download_url                  -> short-lived UI value only
```

No service-role key, provisioning token, or private helper is exposed in browser
types or props.

---

## 9. Migration and deployment sequence

Create migration files only with:

```bash
npx supabase migration new <descriptive_name>
```

Recommended logical phases:

### Phase A — additive department scope

- Departments, permission, General backfill, NOT NULL department.
- Private scope helper.
- Restrictive RLS, including Feature 12 audit tables.
- Department history, guard, and transfer RPC.
- Re-layered list/performance RPCs.
- Provisioning table and temporary compatible Auth trigger.
- Explicit grants, revokes, indexes.

Because all existing users begin in General, the first migration preserves the
current flat visibility until additional departments/users are configured.

### Phase B — compatible application

- Departments UI.
- Department-aware invite route and Users page.
- Transfer UX.
- Employees/performance updates.
- Path columns, safe backfill, updated triggers.
- Authenticated short-lived download flow.
- Dual-read compatibility.

### Phase C — enforcement

- Require a valid one-time invite provisioning token.
- Make both work-file buckets private.
- Verify live isolation and old URL failure.

### Phase D — cleanup after observation

- Remove legacy URL columns and fallback code only after all rows/files are
  verified.
- Keep audit/history tables permanently.

Do not apply a partially tested destructive cleanup to the live project.
Prefer forward-fix migrations if an already-applied migration needs correction.

---

## 10. Automated database test plan

Create a dedicated Feature 13 pgTAP test with:

- one global admin;
- Department A and Department B;
- one HR and employee in each department;
- active, invited, archived, and promoted users;
- tasks, submissions, ratings, activity, lifecycle history, assignment history,
  department history, and file-object fixtures.

### Structural assertions

- New public tables have RLS enabled.
- Private provisioning data has no public/authenticated grants.
- Department foreign keys and all RLS lookup columns are indexed.
- New SECURITY DEFINER functions use empty search paths.
- Trigger functions are not directly executable by application roles.
- No department DELETE policy/grant exists.
- Audit tables are append-only.

### Invite assertions

- Valid token + matching email creates the profile in the intended department.
- Missing token fails after enforcement.
- Invalid, expired, reused, or mismatched-email token fails.
- HR-crafted department input is ignored server-side.
- A failed invite does not leave a usable provisioning record.
- Existing Feature 11/12 fixtures use valid provisioning setup.

### Department isolation assertions

HR A:

- sees only Department A users in management/performance RPCs;
- sees only Department A tasks/submissions/ratings/activity;
- sees only Department A lifecycle/assignment/department history;
- cannot assign or reassign work to Department B;
- cannot review/rate/archive/promote/restore a Department B user;
- cannot call a crafted profile update to change departments;
- cannot open a Department B performance subject.

Admin:

- sees all departments and work;
- can assign across departments;
- can move a user;
- gets one audit row per successful move;
- idempotent retry does not duplicate history.

Employee:

- sees only own tasks and performance;
- retains own submission/rating/activity access;
- cannot gain management visibility from sharing a department.

### Transfer/concurrency assertions

- Same-department transfer is rejected as a no-op.
- Missing/short reason is rejected.
- Invalid department is rejected.
- Concurrent assignment and transfer serialize correctly.
- After transfer, old department loses access and new department gains access.
- Historical work follows the transferred user.
- Archived/promoted historical users can still be moved by admin and remain
  reachable only in the new scope.

### Storage assertions

- Every legacy URL maps to a real storage object before private flip.
- Authorized user can select/sign the referenced object.
- Other department cannot select/sign it even with an exact path.
- An unreferenced uploaded object is not downloadable.
- Public URLs fail after bucket privacy is enabled.
- No overwrite/delete permission weakens evidence immutability.

### Regression assertions

Run the full Feature 11 and Feature 12 tests after updating their fixtures.
All existing rules must remain:

- custom-role permission matrix;
- own-task read vs. `submission.create`;
- protected admin role;
- archive/restore constraints;
- offboarding custody and idempotency;
- submitted-task attribution;
- historical employee behavior within the new department boundary.

---

## 11. Application quality and manual QA

### Commands

```bash
npx tsc --noEmit
npm run build
```

Run:

- Feature 11 pgTAP suite;
- Feature 12 pgTAP suite;
- Feature 13 pgTAP suite;
- Supabase security advisors;
- Supabase performance advisors;
- migration-list verification;
- generated-type diff review.

No new missing-RLS, unsafe-function, exposed-secret, or missing-FK-index finding is
acceptable. Existing intentional advisor warnings must be documented rather than
silently ignored.

### Manual two-department QA

1. Create Sales and Engineering.
2. Place one HR and employee in each.
3. Create work and files for both.
4. Sign in as Sales HR:
   - only Sales users/tasks/performance appear;
   - Engineering IDs and direct URLs fail;
   - Engineering file paths cannot be downloaded.
5. Invite from Sales HR:
   - user always lands in Sales despite a crafted client department ID.
6. Sign in as admin:
   - all departments are visible;
   - invite department picker works;
   - transfer employee Sales -> Engineering with reason.
7. Recheck:
   - Sales immediately loses that employee's work;
   - Engineering gains current and historical work;
   - transfer audit is present exactly once.
8. Archive/restore and promote users in each department.
9. Verify old public file URLs fail and fresh authorized download buttons work.
10. Leave a page open past signed-link expiry and confirm clicking Download gets
    a new working short-lived link.

---

## 12. Edge-case checklist

- [ ] Existing profiles safely backfilled before NOT NULL.
- [ ] Department names normalized and duplicate-safe.
- [ ] No department deletion/orphan path.
- [ ] Archived callers fail closed.
- [ ] Custom roles cannot bypass scope with individual permissions.
- [ ] Feature 11 permission gates are not accidentally narrowed or widened.
- [ ] Feature 12 audit/history tables are scoped.
- [ ] Performance subject enumeration is scoped.
- [ ] HR cannot forge invite department.
- [ ] Invite token is opaque, expiring, email-bound, and one-time.
- [ ] Direct Dashboard invites are documented as unsupported after enforcement.
- [ ] Transfer is locked, audited, reasoned, and idempotent.
- [ ] Transfer changes historical scope by deliberate product decision.
- [ ] Public profile/department directory exposure is documented.
- [ ] Existing file paths are verified against Storage before privacy flip.
- [ ] Protection triggers are updated for new path columns.
- [ ] Upload failure cleanup cannot delete referenced/other-user objects.
- [ ] Signed URLs are generated on demand and expire quickly.
- [ ] Buckets are flipped only after the compatible code is live.
- [ ] Legacy URL columns are removed only in a later verified cleanup.
- [ ] All new grants, sequences, functions, and indexes are explicit.
- [ ] Type generation, build, advisors, automated tests, and manual QA pass.

---

## 13. Viva concepts

- **Departmental multi-tenancy:** one application and schema, with rows isolated
  by department at the database boundary.
- **Restrictive RLS:** a new security condition is AND-combined with existing
  RBAC instead of rewriting it.
- **RBAC vs. scope:** a permission says what action is allowed; department scope
  says which users' data the action may affect.
- **Security definer helper:** a narrowly-scoped private function breaks RLS
  recursion while deriving identity from `auth.uid()`.
- **Defense in depth:** UI guards, RPC checks, RLS, triggers, grants, and Storage
  policies protect different boundaries.
- **Idempotency and audit:** retried transfers do not duplicate changes, and every
  successful change leaves immutable evidence.
- **Concurrency control:** row locks prevent task assignment and department
  transfer from producing inconsistent outcomes.
- **Trusted provisioning:** editable user metadata carries only an opaque
  one-time token; authorization data comes from a private server-created record.
- **Staged migration:** additive schema and dual-compatible code prevent downtime
  while public file URLs are replaced with private access.
- **Signed URL:** a short-lived capability issued only after a fresh authorization
  check.

---

## 14. Suggested commit

```text
Add Feature 13 departmental scope and private work files
```

Use one feature commit after migrations, code, generated types, tests, advisors,
and manual QA all pass. Do not include unrelated untracked project files.
