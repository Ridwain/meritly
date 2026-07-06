# Meritly — Final Design Plan (v1.7)

Employee Work Monitoring & Performance Management System — CSE327.
This document supersedes the data-model and security sections of `PRD.md`.
It is the single source of truth for the schema, security model, and build order.

**How this evolved:** v1.0 (PRD) → v1.1 (integrity: CHECKs, trigger, RLS matrix)
→ v1.2 (soft deletes + RESTRICT) → v1.3 (admin tier) → v1.5 (grant-only HR
delegation) → v1.6 (RBAC-lite) → **v1.7 (security-review fixes — final)**.

---

## 0. Design principles

1. **The database enforces; the UI merely reflects.** Every rule lives in
   Postgres (constraints, triggers, RLS). A bypassed UI changes nothing.
2. **Nothing is ever destroyed.** Removal = archiving (`deleted_at`).
   Hard deletes are blocked twice (no DELETE policies + RESTRICT foreign keys).
3. **Power is data, not law.** Roles are rows; capabilities are permission
   keys. Changing who-can-do-what is an INSERT, not a migration.
4. **Power flows down, recovery flows up.** HR may grant HR status (one-way);
   only the untouchable admin can revoke it.
5. **Rows vs columns:** RLS gates *which rows* you may touch; column-pinning
   triggers gate *which columns*. Two mechanisms, cleanly split.
6. **Build foundations RBAC-shaped; defer the UI.** The role-editor page is a
   stretch feature; the architecture beneath it ships on day one.

---

## 1. Data model — 7 tables

### Domain tables

**`profiles`** — extends `auth.users` 1-to-1 (same `id`)

| Column | Type | Rules |
|---|---|---|
| `id` | uuid PK | FK → `auth.users.id` **ON DELETE RESTRICT** |
| `full_name` | text | not null |
| `role_id` | int | FK → `roles.id` **RESTRICT**; changes gated by pinning trigger |
| `deleted_at` | timestamptz null | NULL = active; set = archived |
| `created_at` | timestamptz | default now() |

**`tasks`**

| Column | Type | Rules |
|---|---|---|
| `id` | uuid PK | |
| `title`, `description` | text | title not null |
| `assigned_to` | uuid | FK → `profiles.id` **RESTRICT**; must be an **active employee** at insert |
| `assigned_by` | uuid | FK → `profiles.id` **RESTRICT**; must equal the inserter (`auth.uid()`) |
| `priority` | text | `CHECK IN ('high','medium','low')` |
| `deadline` | timestamptz | not null |
| `status` | text | `CHECK IN ('pending','in_progress','submitted','completed','needs_revision','overdue')`; transitions whitelisted (§4) |
| `deleted_at` | timestamptz null | soft delete (archive) |
| `created_at`, `updated_at` | timestamptz | `updated_at` maintained by trigger |

Indexes: `assigned_to`, `status`.

**`submissions`** — append-mostly evidence; no `deleted_at`, never deletable

| Column | Type | Rules |
|---|---|---|
| `id` | uuid PK | |
| `task_id` | uuid | FK → `tasks.id` **RESTRICT** |
| `employee_id` | uuid | FK → `profiles.id` **RESTRICT** |
| `note` | text | not null; **frozen after insert** (pinning trigger) |
| `file_url` | text null | **frozen after insert** |
| `submitted_at` | timestamptz | default now() |
| `hr_feedback`, `reviewed_at` | text / timestamptz | the ONLY columns reviewers may write |

Indexes: `task_id`, `employee_id`. Latest submission per task = newest `submitted_at`.

**`ratings`** — **append-only** (no UPDATE or DELETE policies at all)

| Column | Type | Rules |
|---|---|---|
| `id` | uuid PK | |
| `employee_id`, `rated_by` | uuid | FK → `profiles.id` **RESTRICT** |
| `score`, `ai_suggested_score` | int | `CHECK BETWEEN 1 AND 5` |
| `comment`, `ai_summary` | text | |
| `period` | text | e.g. `'2026-07'` |
| `created_at` | timestamptz | default now() |

Index: `employee_id`. To revise a rating: insert a new row for the same
period; the app reads the **latest per (employee, period)**. The revision
trail is preserved by design.

### RBAC tables

| Table | Columns | Notes |
|---|---|---|
| **`roles`** | `id`, `name` unique | seeded: `admin`, `hr`, `employee` |
| **`permissions`** | `id`, `key` unique | catalog in §2 |
| **`role_permissions`** | (`role_id`, `permission_id`) composite PK | junction table; FKs **CASCADE** (these rows are configuration, not evidence) |

---

## 2. Permission catalog & seeded keyrings

| Key | employee | hr | admin | Meaning |
|---|:---:|:---:|:---:|---|
| `submission.create` | ✅ | ✅ | ✅ | submit work for own task |
| `task.create` | | ✅ | ✅ | assign tasks (as self, to active employees) |
| `task.update` | | ✅ | ✅ | edit task fields (not status — see §4) |
| `task.archive` | | ✅ | ✅ | set/clear `tasks.deleted_at` |
| `task.view_all` | | ✅ | ✅ | read everyone's tasks |
| `submission.review` | | ✅ | ✅ | read all submissions; write feedback; complete/return tasks |
| `rating.create` | | ✅ | ✅ | insert ratings (append-only) |
| `rating.view_all` | | ✅ | ✅ | read everyone's ratings |
| `stats.view_all` | | ✅ | ✅ | performance dashboard |
| `user.promote` | | ✅ | ✅ | change role of a **current employee** to employee/hr (one-way grant) |
| `user.archive` | | ✅ | ✅ | archive/restore **employees** |
| `user.manage_all` | | | ✅ | demote/archive **HRs**; any role change except self; may **never write `admin`** |
| `role.manage` | | | ✅ | edit roles/permissions (stretch Feature 11 only) |

Ownership rules ("my tasks", "my submissions") are not permission keys —
they are hardcoded `= auth.uid()` checks in policies. Keys govern privileged
capability; ownership governs personal access.

**Single-admin invariant:** the `admin` role is *unassignable through the
API by anyone* — `user.manage_all`'s WITH CHECK only permits writing
`employee`/`hr`. Admin exists only via the one-time bootstrap seed (§5).
This prevents the "admin coup" (create co-admin → co-admin archives you).

---

## 3. Database functions & triggers

| Object | Type | Purpose |
|---|---|---|
| `has_permission(key)` | fn, **SECURITY DEFINER** | the security pivot: caller's profile → role → role_permissions; **also requires `is_active()`** — archived users hold no permissions |
| `is_active()` | fn, **SECURITY DEFINER** | caller's own `deleted_at IS NULL`; woven into ownership and storage policies |
| `handle_new_user()` | trigger on `auth.users`, SECURITY DEFINER | auto-creates the `profiles` row on signup, **always role = employee** (kills half-failed signups AND the signup privilege hole) |
| `set_updated_at()` | trigger | maintains `tasks.updated_at` |
| `flag_overdue_tasks()` | fn, SECURITY DEFINER | `pending`/`in_progress` past deadline → `overdue`; **skips archived tasks**; called on dashboard loads |
| pinning trigger on `profiles` | BEFORE UPDATE | `role_id`/`deleted_at` change ⇒ caller must hold the matching `user.*` key; others may not touch them |
| pinning trigger on `tasks` | BEFORE UPDATE | non-status columns ⇒ `task.update`; `deleted_at` ⇒ `task.archive`; status ⇒ whitelist §4 |
| pinning trigger on `submissions` | BEFORE UPDATE | only `hr_feedback`/`reviewed_at` may ever change, and only by `submission.review` holders |

Why SECURITY DEFINER: these functions must read/write rows the calling user
cannot (e.g. `has_permission` reads `profiles`, whose own policies call
`has_permission` — the classic RLS recursion; DEFINER breaks the loop safely).

---

## 4. Task status — transition whitelist

Free-form status writes are forbidden (an employee must never self-`complete`).
The only legal moves:

| From → To | Who |
|---|---|
| `pending` → `in_progress` | owner (active), via Start |
| `in_progress` / `needs_revision` / `overdue` → `submitted` | owner, via submit flow (late submissions stay recordable — that is what "late" stats are) |
| `submitted` → `completed` | `submission.review` holder |
| `submitted` → `needs_revision` | `submission.review` holder |
| `pending` / `in_progress` → `overdue` | `flag_overdue_tasks()` only |

Enforced in the tasks UPDATE policy: `USING` checks the old status,
`WITH CHECK` the new — both gates must pass. Archived tasks accept no
status changes.

---

## 5. Authentication & bootstrap

1. **Signup:** email + password + full name — **no role choice**. The trigger
   creates the profile as `employee`; even a forged API signup cannot inject
   a higher role.
2. **Login:** Supabase Auth; session read server-side via cookies
   (`src/lib/supabaseServer.js`).
3. **Archived users:** login still *authenticates* (we never delete
   `auth.users`) but: RLS/`is_active()` denies all data access (the real
   lock), and middleware shows "account deactivated" (the polite UX layer).
   Two layers, one truth: auth ≠ authorization.
4. **Sidebar variants:** employee / hr / admin.
5. **Bootstrap (root-user pattern):** first account signs up normally; its
   `role_id` is flipped to `admin` once via direct SQL. Thereafter `admin`
   is unassignable (§2).
6. Email confirmation off for the demo (would be on in production).

---

## 6. Row Level Security — full matrix

Deny-by-default. The **empty DELETE column is deliberate**: no DELETE policy
exists anywhere ⇒ hard deletion via the API is impossible (security by omission).

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| **profiles** | own row always, plus all rows if `is_active()` (archived users see only themselves) | trigger only | own row (pinned: not `role_id`/`deleted_at`) · or `user.promote` (target currently employee; new role ∈ {employee, hr}) · or `user.archive` (target employee; `deleted_at` only) · or `user.manage_all` (any target except self; role writes ∈ {employee, hr}) | — |
| **tasks** | (owner AND `is_active()`) or `task.view_all` | `task.create` AND `assigned_by = auth.uid()` AND target is active employee | owner: whitelist §4 only · `task.update` (fields) · `task.archive` (`deleted_at`) | — |
| **submissions** | owner or `submission.review` | `submission.create` AND task is mine AND task status ∈ {in_progress, needs_revision, overdue} AND task not archived | `submission.review`, feedback columns only (pinned) | — |
| **ratings** | own or `rating.view_all` | `rating.create` AND `rated_by = auth.uid()` | **none — append-only** | — |
| **roles / permissions / role_permissions** | any logged-in user | `role.manage` | `role.manage` | `role.manage` |

Notes:
- SELECT does **not** hide archived rows — filtering is the app's job; HR
  must retain queryable history (the point of retention).
- Multiple UPDATE policies on `profiles` OR-combine; the pinning trigger is
  the safety net across all of them.
- Any **active** logged-in user can enumerate the staff directory via
  `profiles` SELECT (needed for assignee dropdowns). Archived users can read
  only their own row. Fine at this scale; production would scope reads to
  one's own department.

---

## 7. Storage

| Decision | Value |
|---|---|
| Bucket | `submissions`, **public read** (trade-off: URL-holders can download; unguessable URLs; production = private + signed URLs) |
| Upload path | `<employee-id>/<task-id>-<timestamp>-<filename>` — collision-proof |
| Upload policy | INSERT only, `is_active()`, and **first path folder must equal `auth.uid()`** (own-folder rule) |
| Overwrite/delete | **no UPDATE/DELETE policies ⇒ files are immutable** — a reviewed file can never be silently swapped (evidence integrity) |
| Limits | ~10 MB per file; documents/images/archives MIME whitelist |
| Pattern | file bytes in Storage; URL string in `submissions.file_url` |

---

## 8. Build order & per-feature notes

| # | Feature | Notes (deltas vs `PRD.md`) |
|---|---|---|
| 1 | Setup | ✅ **done** — Next.js 14 + Tailwind + Supabase clients; repo `meritly` on GitHub |
| **2** | **Database schema** | **next** — one migration: 7 tables, CHECKs, RESTRICT FKs, indexes, RBAC seeds, all functions/triggers (§3), full RLS (§6), storage bucket + policies (§7). Applied via the Supabase connection, then **verified with impersonation tests** (see §10) |
| 3 | Auth & roles | signup has NO role dropdown and NO manual profile insert (trigger does it); archived-user block; 3 sidebar variants |
| 3.5 | User management panel | `/dashboard/users` for hr+admin: all accounts incl. archived; buttons by rank — hr: Promote-to-HR (employees only), Archive/Restore (employees only); admin: everything except self; **no one can touch admin or self** |
| 4 | HR task assignment | archive (not delete) button; assignee dropdown = active employees only |
| 5 | Employee task view | filter `deleted_at IS NULL`; Start = pending → in_progress |
| 6 | Work submission | upload to own folder with unique path; insert submission; task → submitted (whitelisted transition) |
| 7 | HR review | approve → completed / return → needs_revision; writes feedback columns only |
| 8 | Overdue tracking | `flag_overdue_tasks()` RPC on dashboard loads; skips archived |
| 9 | Performance dashboard | active-only lists; stats over non-archived tasks; archived employees' history remains queryable |
| 10 | AI summary & rating | route verifies `rating.create` server-side BEFORE calling Gemini (quota protection); use a current Gemini model (PRD's `gemini-1.5-flash` is outdated); rating saved as new append-only row |
| 11+ | Stretch (only after 1–10) | role-editor UI (→ full RBAC; `role.manage` key already reserved) · notifications · employee self-view of ratings |

---

## 9. Deliberately NOT built (viva talking points)

- **Attempt numbers on submissions** — latest-by-timestamp suffices.
- **Postgres enums** — CHECK constraints are equivalent and simpler.
- **Audit log, approval workflows (four-eyes), SSO/SCIM, break-glass
  accounts** — enterprise rungs; be able to *explain* the ladder: granular
  RBAC → scoped grants → approval workflows → append-only audit → SSO.
- **Role-editor UI** — deferred by design; the architecture already
  supports it (adding a "Team Lead" role is an INSERT, not a migration).
- **Private storage bucket + signed URLs** — the production answer; public
  bucket chosen as a documented demo trade-off.
- **Soft-delete rationale** — labor-law-style record retention; CASCADE
  would have been acceptable for a demo but retention was chosen
  deliberately.

## 10. Security acceptance tests (run after Feature 2, then before demo)

Impersonating a test **employee**:
1. `SELECT` another employee's tasks → 0 rows.
2. `UPDATE` own task status to `completed` → rejected (whitelist).
3. `UPDATE` own `role_id` → rejected (pinning trigger).
4. `INSERT` a rating for self → rejected (no `rating.create`).
5. Upload into another user's storage folder → rejected.

Impersonating an **HR**:
6. Demote another HR → rejected (`user.promote` requires target = employee).
7. Set anyone's role to `admin` → rejected (invariant).
8. Edit a submission's `note` → rejected (pinning trigger).
9. `DELETE` any row anywhere → rejected (no DELETE policies).

Impersonating an **archived** user:
10. Any read/write → 0 rows / rejected (`is_active()`).

## 11. Success criteria

- [ ] Signup always creates an employee; first admin seeded once.
- [ ] Admin/HR can promote an employee to HR from the panel; only admin can demote.
- [ ] Archiving a user blocks their access (API-level, not just UI) and
      preserves all their history.
- [ ] HR assigns a task; employee starts, submits with file; HR approves or
      returns; overdue tasks flag automatically.
- [ ] Performance dashboard + AI rating flow work end-to-end.
- [ ] All §10 security tests pass.
