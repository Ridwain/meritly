# Feature 11 — First-Class Roles & Permission Management (Implementation Spec)

> **This document is a self-contained implementation spec.** It assumes no prior
> conversation context. Read it top to bottom before writing any code.
>
> ⚠️ **This feature edits security-critical code** (RLS policies + triggers). Do
> the work on a **branch**, regenerate types, run the Supabase advisors, and
> complete the FULL re-test checklist in §10 before merging.

---

## 0. TL;DR for the implementer

Make **roles first-class**: an admin can create brand-new roles, assign permission
keys to them, and assign users to them — and the new roles work everywhere,
including task assignment, HR user management, and the performance list. Today the
codebase hardcodes the role names `employee`/`hr`/`admin` in a handful of database
objects; this feature replaces those name checks with **role attribute flags**,
then adds the admin UI and switches the Users page to **permission-based** gating.

### Prerequisites & cross-feature ordering (read this)
- **Prerequisite: none** (build on the current codebase). Recommended roadmap
  order: **10 → 11 → 12 → 13.**
- This is the ONLY feature that redefines `protect_profile_columns`,
  `admin_list_users`, `assignable_employees`, `is_assignable_employee`, and
  `profiles_update_manage`. Features 12 and 13 are written to **NOT** rewrite these
  again — Feature 12 adds a *separate* trigger, and Feature 13 adds *separate
  restrictive policies* and only re-layers two list functions. That decoupling is
  deliberate (it is how production systems avoid multiple features clobbering one
  another). Do not merge Feature 11's concerns into those later migrations.
- **Golden rule for any later migration that DOES redefine a function** (only
  Feature 13's `admin_list_users` / `assignable_employees` do): base the new
  version on the **current live definition** (i.e. Feature 11's output), never on
  an older migration's text.

---

## 1. Project context (so you can work without the original chat)

**Meritly** — an Employee Work Monitoring & Performance Management System. HR/Admin
assign tasks, employees submit work, the system tracks completion/overdue, HR
reviews performance. University project; keep code **clear and simple over
clever**, brief comments on non-obvious lines.

- **Next.js 16** (App Router), **React 19**, **TypeScript** `strict: true`,
  **Tailwind v3**, **Supabase** (Postgres + Auth + Storage).
- Client helpers: `createSupabaseServerClient()` (server, session, RLS),
  `createSupabaseBrowserClient()` (browser, RLS) for user writes,
  `createSupabaseAdminClient()` (service role — not needed here).
- **Security philosophy:** "the database enforces; the UI merely reflects." All
  access control lives in RLS + triggers; the UI only hides controls. Every write
  in this feature is gated by an RLS policy requiring `role.manage` (admin-only).
- Pattern: Server Component `page.tsx` (guard + fetch) → `*Client.tsx`
  (interactivity). Reuse `src/components/ui/` primitives.
- Conventions: don't commit `.env.local` / `CLAUDE.md` /
  `.claude/settings.local.json`; no `Co-Authored-By` trailer; verify in a browser.

---

## 2. How RBAC works today (reference)

Tables (migration 01): `roles(id, name)`, `permissions(id, key)`,
`role_permissions(role_id, permission_id)`. `profiles.role_id` references
`roles(id)` (RESTRICT: a role with users can't be deleted). Access is decided by
`public.has_permission(perm text)` (migration 02), which reads
`profiles → role_permissions → permissions` **live**, so keyring changes take
effect immediately. RLS (migration 03): everyone may `select` the RBAC tables;
only `role.manage` holders may write them. `role.manage` is granted only to
`admin`.

### The problem this feature solves
Besides permission keys, several database objects hardcode the role **name**
`'employee'` / `'hr'` / `'admin'` as a proxy for a *capability*, so a new role
would bypass them. This feature replaces those with **flags on `roles`**.

---

## 3. The design — three role flags

| Flag | Meaning | Seeded true for | Replaces |
|------|---------|-----------------|----------|
| `assignable_work` | **Worker**: can be assigned tasks, appears in the assignee dropdown + performance list, and is the kind of user HR may archive/promote. | `employee` | `roles.name = 'employee'` |
| `protected` | **System role**: cannot be assigned via API, edited, or deleted (seed-only). Preserves the single-admin invariant. | `admin` | `roles.name = 'admin'` |
| `hr_grantable` | HR (holder of `user.promote`) may promote a worker **into** this role. | `hr` | the implicit "HR promotes employee→hr" rule |

New custom roles created via the UI: admin chooses `assignable_work`; `protected`
is always false (the UI cannot create protected roles); `hr_grantable` defaults
false (custom roles are admin-assigned only — the safe default).

Why flags, not names: a capability ("can receive tasks") should be a property of
the role, not tied to a magic string. That is what makes roles first-class.

---

## 4. PART 1 — Database migration

Create `supabase/migrations/15_first_class_roles.sql`. SQL is written against the
**current live definitions** (migrations 05, 10, 11). Every change is "role-name
check → flag check"; nothing else changes.

```sql
-- Migration 15: make roles first-class (Feature 11).

-- 1) Flags on roles ---------------------------------------------------------
alter table public.roles
  add column assignable_work boolean not null default false,
  add column protected       boolean not null default false,
  add column hr_grantable     boolean not null default false;

update public.roles set assignable_work = true where name = 'employee';
update public.roles set protected       = true where name = 'admin';
update public.roles set hr_grantable     = true where name = 'hr';

-- 2) Guard: protected roles are seed-only, immutable, undeletable via API.
create or replace function public.protect_roles()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then                       -- direct SQL (seed/migration)
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if old.protected then raise exception 'protected roles cannot be deleted'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if old.protected or new.protected then
      raise exception 'protected roles cannot be modified';
    end if;
    return new;
  end if;
  if new.protected then raise exception 'cannot create protected roles'; end if;  -- INSERT
  return new;
end;
$$;
create trigger protect_roles
  before insert or update or delete on public.roles
  for each row execute function public.protect_roles();
revoke execute on function public.protect_roles() from anon, authenticated, public;

-- 3) Worker check for task assignability (was: r.name = 'employee') ----------
create or replace function public.is_assignable_employee(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.id = target
      and p.deleted_at is null
      and r.assignable_work                         -- was: r.name = 'employee'
      and p.accepted_at is not null
  );
$$;

create or replace function public.assignable_employees()
returns table (id uuid, full_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('task.create') then
    raise exception 'not allowed to list assignable employees';
  end if;
  return query
    select p.id, p.full_name
    from public.profiles p
    join public.roles r on r.id = p.role_id
    where p.deleted_at is null
      and r.assignable_work                         -- was: r.name = 'employee'
      and p.accepted_at is not null
    order by p.full_name;
end;
$$;

-- 4) profiles column-pinning trigger: role-name checks -> flag checks --------
--    (Based on the migration-11 body; only role-gating lines change.)
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_assignable   boolean;
  new_protected    boolean;
  new_hr_grantable boolean;
begin
  if auth.uid() is null then return new; end if;

  if new.id is distinct from old.id then
    raise exception 'profile id cannot change';
  end if;

  -- role changes
  if new.role_id is distinct from old.role_id then
    select protected, hr_grantable into new_protected, new_hr_grantable
      from public.roles where id = new.role_id;
    select assignable_work into old_assignable
      from public.roles where id = old.role_id;

    if coalesce(new_protected, false) then
      raise exception 'protected roles cannot be assigned';        -- was: name = 'admin'
    end if;
    if old.id = auth.uid() then
      raise exception 'you cannot change your own role';
    end if;
    if public.has_permission('user.manage_all') then
      null;                                                        -- admin: any non-protected role
    elsif public.has_permission('user.promote')
          and coalesce(old_assignable, false)                      -- current role is a worker
          and coalesce(new_hr_grantable, false) then               -- target is HR-grantable
      null;                                                        -- HR: promote a worker into an HR-grantable role
    else
      raise exception 'not allowed to change this user''s role';
    end if;
  end if;

  -- archive / restore
  if new.deleted_at is distinct from old.deleted_at then
    select assignable_work into old_assignable
      from public.roles where id = old.role_id;
    if old.id = auth.uid() then
      raise exception 'you cannot archive yourself';
    end if;
    if public.has_permission('user.manage_all') then
      null;
    elsif public.has_permission('user.archive')
          and coalesce(old_assignable, false) then                 -- was: role = employee
      null;                                                        -- HR: workers only
    else
      raise exception 'not allowed to archive or restore this user';
    end if;
  end if;

  -- accepted_at guard (unchanged from migration 11)
  if new.accepted_at is distinct from old.accepted_at then
    if old.id <> auth.uid() then
      raise exception 'only the account owner may accept their own invite';
    end if;
    if old.accepted_at is not null then
      raise exception 'accepted_at cannot be changed once set';
    end if;
  end if;

  return new;
end;
$$;

-- 5) profiles_update_manage policy: employee-name -> worker flag -------------
--    (Based on the migration-05 body; only the USING role check changes.)
drop policy "profiles_update_manage" on public.profiles;
create policy "profiles_update_manage" on public.profiles
  for update to authenticated
  using (
    id <> auth.uid()
    and (
      public.has_permission('user.manage_all')
      or (
        (public.has_permission('user.promote') or public.has_permission('user.archive'))
        and role_id in (select id from public.roles where assignable_work)  -- was: = employee id
      )
    )
  )
  with check (
    id <> auth.uid()
    and (
      public.has_permission('user.manage_all')
      or public.has_permission('user.promote')
      or public.has_permission('user.archive')
    )
  );

-- 6) admin_list_users: HR sees workers (was: name = 'employee') --------------
drop function public.admin_list_users();
create function public.admin_list_users()
returns table (id uuid, full_name text, role text, email text,
               deleted_at timestamptz, accepted boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_permission('user.invite') then
    raise exception 'not allowed to list users';
  end if;
  return query
    select p.id, p.full_name, r.name, u.email::text, p.deleted_at,
           (p.accepted_at is not null) as accepted
    from public.profiles p
    join public.roles r on r.id = p.role_id
    join auth.users u on u.id = p.id
    where p.id <> auth.uid()
      and (
        public.has_permission('user.manage_all')
        or r.assignable_work                        -- was: r.name = 'employee'
      )
    order by p.created_at;
end;
$$;
revoke execute on function public.admin_list_users() from anon, public;
grant execute on function public.admin_list_users() to authenticated;
```

**Do NOT change** `handle_new_user()` (migration 02) — new signups defaulting to
the `employee` role is correct and intended.

After applying: run the Supabase **security** and **performance** advisors; expect
no NEW findings vs. the baseline (pre-existing SECURITY DEFINER and
multiple-permissive-policy warnings are intentional).

---

## 5. PART 2 — Regenerate types

`roles` gained three columns, so regenerate `src/lib/database.types.ts` from the
live schema (Supabase CLI / MCP `generate_typescript_types`). Do not hand-edit.
Confirm `roles.Row` now includes `assignable_work`, `protected`, `hr_grantable`.

---

## 6. PART 3 — Roles management UI (`/dashboard/roles`, admin only)

### CREATE `src/app/dashboard/roles/page.tsx` (Server Component)
```ts
const supabase = await createSupabaseServerClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) redirect("/login");
const { data: canManage } = await supabase.rpc("has_permission", { perm: "role.manage" });
if (!canManage) redirect("/dashboard");

const { data: roles } = await supabase
  .from("roles").select("id, name, assignable_work, protected, hr_grantable").order("id");
const { data: permissions } = await supabase.from("permissions").select("id, key").order("key");
const { data: rolePerms } = await supabase.from("role_permissions").select("role_id, permission_id");

return <RolesClient roles={roles ?? []} permissions={permissions ?? []} rolePerms={rolePerms ?? []} />;
```

### CREATE `src/app/dashboard/roles/RolesClient.tsx` (Client Component)
`"use client"`. All writes via `createSupabaseBrowserClient()`; RLS enforces
`role.manage`.
1. **Create role** — form: `name` + "Can be assigned tasks" checkbox
   (`assignable_work`). `insert({ name, assignable_work })`. Handle unique-name
   errors. (`protected`/`hr_grantable` are not set; the `protect_roles` trigger
   rejects creating a protected role.)
2. **Keyring editor** — per role, a checkbox per permission key
   (state = `Set` of `"${role_id}:${permission_id}"`). Toggle → insert/delete a
   `role_permissions` row.
3. **The `protected` role (admin) is read-only** — its permissions render checked
   + `disabled` with a note. Never send a write for it.
4. **Toggle `assignable_work`** on a non-protected role (updates `roles`).
5. **Delete a role** (optional, guarded) — only non-protected roles with **no
   users** (check `profiles` count; the FK also blocks it).
6. Friendly label map for keys (fallback to raw key). `Notice` for errors + a
   subtle "Saved". One-line caption that changes apply immediately.

> Keep `hr_grantable` out of the v1 UI (defaults false → custom roles are
> admin-assigned only, the safe default).

### CHANGE `src/app/dashboard/layout.tsx`
Add `{ href: "/dashboard/roles", label: "Roles" }` to the **admin** nav array
ONLY.

### CHANGE `src/app/dashboard/Sidebar.tsx`
Add `import { ShieldCheck } from "lucide-react";` and
`"/dashboard/roles": ShieldCheck,` to the `ICONS` map.

---

## 7. PART 4 — Users page: assign any role, gated by PERMISSION (not role name)

> **Issue fix (important):** today `UsersTable.tsx` decides which buttons to show
> with `viewer.role === "admin"` / `=== "hr"` string checks. Once custom roles
> exist, a custom role could hold `user.manage_all` (or `user.promote`), so gating
> on the role NAME is wrong. Gate on **permissions**, computed on the server and
> passed in.

### CHANGE `src/app/dashboard/users/page.tsx`
Compute the viewer's capabilities via `has_permission` and pass them down, plus
the roles list (with flags):
```ts
const [{ data: canManageAll }, { data: canPromote }, { data: canArchive }] = await Promise.all([
  supabase.rpc("has_permission", { perm: "user.manage_all" }),
  supabase.rpc("has_permission", { perm: "user.promote" }),
  supabase.rpc("has_permission", { perm: "user.archive" }),
]);
const { data: roles } = await supabase
  .from("roles").select("id, name, assignable_work, protected, hr_grantable").order("id");

// pass viewerCaps={{ manageAll: !!canManageAll, promote: !!canPromote, archive: !!canArchive }}
// and roles to <UsersTable />
```

### CHANGE `src/app/dashboard/users/UsersTable.tsx`
Replace all `viewer.role === "admin"` / `=== "hr"` gating with the passed-in
`viewerCaps`:
- Never show actions for `u.id === viewer.id` ("You") or for a target whose role
  is `protected` ("—").
- **`viewerCaps.manageAll`** (admin): render a role **`<select>`** whose options
  are all **non-protected** roles (from the roles list), current value = the
  user's role; on change → `apply(u.id, { role_id })`. Plus Archive/Restore.
- **Else, `viewerCaps.promote` / `viewerCaps.archive`** (HR): for **worker**
  users (their role has `assignable_work`), show a "Promote" control whose options
  are the `hr_grantable` roles, plus Archive/Restore. For non-worker users, show
  "—".
- Keep `apply()` as-is (browser client update; RLS + the refactored trigger are
  the gate). Just pass `role_id` from the dropdown.

Derive all options from the roles table + flags — never from hardcoded names.

---

## 8. What NOT to do
- ❌ Do NOT add a "create new role" form that can set `protected`.
- ❌ Do NOT make the `admin`/protected role editable/assignable.
- ❌ Do NOT gate the Users page on role-NAME strings — gate on permissions.
- ❌ Do NOT add permission-key CRUD (a new key does nothing without code).
- ❌ Do NOT hardcode the permission-key list in the UI — read from `permissions`.
- ❌ Do NOT use the service-role client.

---

## 9. Interaction with Features 12 & 13
- **Feature 12** adds a *separate* trigger (`guard_profile_offboarding`); it does
  NOT rewrite `protect_profile_columns`. It relies on the `assignable_work` flag
  this feature adds, so apply Feature 11 first.
- **Feature 13** adds *separate restrictive policies* for department isolation and
  re-layers only `admin_list_users` and `assignable_employees` on top of THIS
  feature's versions (adding a department predicate). It does not otherwise touch
  this feature's objects.

---

## 10. Acceptance criteria — FULL RBAC re-test (mandatory)
### Build/quality
1. `npx tsc --noEmit` passes; `npm run build` succeeds; `/dashboard/roles` route
   exists; `database.types.ts` includes the new columns.
2. Supabase advisors: no new findings vs. baseline.

### Existing invariants must STILL hold
3. HR can still promote a worker (employee) → HR and archive/restore an employee.
4. HR cannot archive/change another HR or the admin.
5. Admin cannot be assigned to anyone; the `admin` role is not an option in any
   role dropdown and is read-only on `/dashboard/roles`.
6. A task can be assigned only to an accepted, active worker; the dropdown lists
   exactly those.
7. Employees still cannot reach `/dashboard/users`, `/dashboard/roles`,
   `/dashboard/employees`; the `?emp=` performance guard holds.
8. Nobody can change their own role or archive themselves.

### New behaviour
9. Admin creates "Manager" (`assignable_work=false`) with `stats.view_all` +
   `submission.review` + `task.view_all`, assigns a user to it → that user can
   review + view performance, but is NOT in the assignee dropdown or the
   Employees/performance list.
10. Admin creates "Intern" (`assignable_work=true`), a user in it can be assigned
    tasks, appears in the dropdown and performance list, and can be archived by HR.
11. Toggling a permission on a role takes effect immediately (remove
    `user.archive` from HR → HR's archive rejected; re-add → works). **Restore
    original keyrings after testing.**
12. Crafted attempts to create a protected role, delete the admin role, or mark a
    role protected all fail with `protect_roles` errors.
13. **Issue-fix check:** grant a custom role `user.manage_all`, assign a user to
    it; that user sees admin-style controls on the Users page (because gating is
    permission-based, not name-based). Revert after testing.

> ⚠️ Experiment only on non-admin roles; restore original keyrings/flags after.
> Baselines: `supabase/migrations/01_schema.sql` + the flags seeded here.

---

## 11. Test accounts
Password for all: `Meritly!Test123`
- `ridwainislam@gmail.com` — Admin (holds `role.manage`, `user.manage_all`)
- `hr.hana@meritly.test` — HR
- `emp.sara@meritly.test`, `emp.rafi@meritly.test` — Employees (workers)

---

## 12. Suggested commit
```
Add Feature 11: first-class roles and permission management
```
(single commit; no `Co-Authored-By` trailer)

---

## 13. Concepts this feature demonstrates (for the viva)
- **Removing magic strings** — role capabilities become explicit attributes
  (`assignable_work`, `protected`, `hr_grantable`) instead of hardcoded names.
- **Invariant-preserving refactor** — `protected` reproduces the single-admin
  invariant; `protect_roles` enforces it.
- **Capability- (permission-) based authorization** — the UI and the DB both gate
  on permissions, not on role identity, so custom roles behave correctly.
- **Fail-safe defaults** — new roles are non-worker, non-protected, admin-managed;
  every capability is opt-in.
```
