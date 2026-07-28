# Feature 11 Permission Audit

## Scope

This audit covers all 14 Feature 11 permission keys across:

- server-side page and navigation guards;
- Postgres Row Level Security (RLS), trigger functions, and RPCs;
- Supabase Storage upload policies;
- immediate grant/revoke behavior;
- archived-user fail-closed behavior;
- the permission bundles needed for complete UI workflows.

Connected Supabase project: `zovgrzqzdabxmwtxrake`.

## Result

All 14 permission keys resolve from the database keyring and take effect
immediately. Every key has at least one database enforcement point.

The audit found and fixed three authorization edge cases:

1. A user without `submission.create` could still use the own-task status
   transition and upload path. Those operations now require the permission.
2. An archived user could still read the role and permission catalog. Those
   catalog policies and `my_role()` now fail closed for archived users.
3. `rating.create` allowed self-rating, a forged `rated_by`, and rating a
   non-worker role. The insert policy now validates all three conditions.

The Roles screen also warns when a permission is enabled without the other
permissions required to make its complete workflow usable.

## Permission Matrix

| Permission | What it authorizes | Main database enforcement |
| --- | --- | --- |
| `task.view_all` | Read every active task instead of only owned tasks | `tasks_select` |
| `task.create` | Create tasks and upload task attachments | `tasks_insert`, `assignable_employees()`, task storage policy |
| `task.update` | Edit managed task fields and replace attachments | `tasks_update_manage`, `protect_task_columns()`, task storage policy |
| `task.archive` | Soft-delete or restore tasks | `tasks_update_manage`, `protect_task_columns()` |
| `submission.create` | Start and submit owned work and upload evidence | `tasks_update_own`, `protect_task_columns()`, `submissions_insert`, submission storage policy |
| `submission.review` | Read submissions and perform review transitions | `submissions_select`, `submissions_update_review`, task/submission protection triggers |
| `stats.view_all` | Read team activity and open team performance pages | `activity_log_select`, `admin_list_users()` |
| `rating.view_all` | Read ratings for other users | `ratings_select` |
| `rating.create` | Rate another active, accepted, assignable worker as the signed-in rater | `ratings_insert` |
| `user.invite` | List the allowed user scope and send invitations | `admin_list_users()`, invite API route |
| `user.promote` | Change another user to an HR-grantable role | `profiles_update_manage`, `protect_profile_columns()` |
| `user.archive` | Archive or restore an allowed user | `profiles_update_manage`, `protect_profile_columns()` |
| `user.manage_all` | Manage users beyond the HR-limited scope, except protected/self constraints | `profiles_update_manage`, `protect_profile_columns()`, `admin_list_users()` |
| `role.manage` | Create, edit, delete, and configure non-protected roles | role and keyring RLS policies plus protection triggers |

## Complete Permission Bundles

Permissions remain independently enforced at the database boundary, but some
screens need a bundle to form a useful end-to-end workflow:

| Workflow | Required bundle |
| --- | --- |
| Assign tasks | `task.view_all` + `task.create` |
| Edit team tasks | `task.view_all` + `task.update` |
| Archive team tasks | `task.view_all` + `task.archive` |
| Review submissions | `task.view_all` + `submission.review` |
| View team performance | `task.view_all` + `submission.review` + `stats.view_all` |
| View all ratings | `stats.view_all` + `rating.view_all` |
| Create ratings | `stats.view_all` + `rating.view_all` + `rating.create` |

`rating.create` and `rating.view_all` are database-ready, but their final UI
belongs to Feature 10, which is currently skipped.

## Automated Verification

The repeatable pgTAP suite is:

`supabase/tests/database/feature_11_rbac_test.sql`

It creates isolated users, roles, tasks, submissions, and ratings inside one
transaction, impersonates authenticated users, runs 83 assertions, and ends
with `ROLLBACK`.

Live rollback-only checks completed during this audit:

- all 14 keys returned `false` before grant and `true` immediately after grant;
- an unknown permission key failed closed;
- each of the 14 keys was found in an RLS policy or protected database
  function;
- archived users lost effective permissions, role lookup, and role/permission
  catalog access;
- valid worker rating was accepted;
- self-rating, non-worker rating, and forged `rated_by` were rejected;
- `test_role` was restored after every test.

To run the full suite after linking the Supabase CLI:

```bash
supabase test db supabase/tests/database/feature_11_rbac_test.sql --linked
```

The current workstation CLI is not linked, so the complete file was not run
end-to-end from the CLI in this audit. The focused live checks above were run
against the connected project with explicit transaction rollback.

## Manual UI Checklist

Use a disposable accepted user assigned to `test_role`:

1. Grant only `submission.create`; confirm My Tasks allows owned work but team
   task, user, role, and performance screens remain unavailable.
2. Toggle each complete bundle from the table above and refresh the app.
3. Confirm the related navigation, page, button, and database operation appear
   together.
4. Remove one dependency from a bundle and confirm the Roles screen shows an
   amber "Incomplete permission bundle" warning.
5. Archive the disposable user and confirm protected application data becomes
   unavailable.

Browser verification completed with the documented HR and Employee accounts:

- HR saw Tasks, Employees, and Users, but not Roles or My Tasks;
- HR saw task create/edit/archive/review controls and only active accepted
  workers in the assignee picker;
- HR saw invite/promote/archive controls for worker-like roles;
- Employee saw only Overview and My Tasks;
- direct Employee navigation to Tasks, Users, Roles, and Employees redirected
  to the dashboard;
- Employee dashboard accurately showed owned-task and submission capabilities.

The saved Admin password in the old Feature 11 plan still does not sign in, so
custom-role bundle warnings and Admin-only role editing remain the only browser
checks requiring a currently valid Admin login.

## Preserved `test_role` Baseline

After the audit:

- `assignable_work`: enabled;
- permission keyring: `submission.create` only;
- accepted test user: `Rid101`;
- no audit fixture or rating row persisted.

## Advisor Notes

Supabase advisors reported no new warning caused by the audit migration.
Existing warnings remain for intentionally exposed `SECURITY DEFINER` RPCs,
leaked-password protection being disabled, older RLS performance patterns,
two unindexed foreign keys, and currently unused indexes. These should be
handled as a separate hardening/performance task so Feature 11 behavior does
not change during this permission audit.
