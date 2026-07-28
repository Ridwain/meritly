"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, Plus, ShieldCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import type {
  Notice,
  PermissionOption,
  RoleOption,
  RolePermissionRow,
} from "@/lib/types";

const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

const PERMISSION_LABELS: Record<string, string> = {
  "task.create": "Create tasks",
  "task.update": "Edit tasks",
  "task.archive": "Archive tasks",
  "task.view_all": "View all tasks",
  "submission.create": "Submit work",
  "submission.review": "Review submissions",
  "stats.view_all": "View all performance",
  "rating.create": "Create ratings",
  "rating.view_all": "View all ratings",
  "user.invite": "Invite users",
  "user.promote": "Promote workers",
  "user.archive": "Archive workers",
  "user.manage_all": "Manage all users",
  "role.manage": "Manage roles",
};

// Action permissions stay atomic in the database. These are the companion
// permissions needed to make the corresponding app screen useful end to end.
const PERMISSION_DEPENDENCIES: Record<string, string[]> = {
  "task.create": ["task.view_all"],
  "task.update": ["task.view_all"],
  "task.archive": ["task.view_all"],
  "submission.review": ["task.view_all"],
  "stats.view_all": ["task.view_all", "submission.review"],
  "rating.create": ["stats.view_all", "rating.view_all"],
  "rating.view_all": ["stats.view_all"],
};

const PERMISSION_NOTES: Record<string, string> = {
  "stats.view_all":
    "Full performance metrics also need View all tasks and Review submissions.",
  "rating.create": "The rating form arrives with Feature 10.",
  "rating.view_all": "The rating history UI arrives with Feature 10.",
  "user.promote":
    "Role changes work alone; optional work transfer also needs View all tasks and Edit tasks.",
  "user.archive":
    "Archiving works alone; optional work transfer also needs View all tasks and Edit tasks.",
  "user.manage_all":
    "User management works alone; optional work transfer also needs View all tasks and Edit tasks.",
};

function permissionPair(roleId: number, permissionId: number): string {
  return `${roleId}:${permissionId}`;
}

export type RolesClientProps = {
  initialRoles: RoleOption[];
  permissions: PermissionOption[];
  initialRolePermissions: RolePermissionRow[];
};

export default function RolesClient({
  initialRoles,
  permissions,
  initialRolePermissions,
}: RolesClientProps) {
  const supabase = createSupabaseBrowserClient();
  const [roles, setRoles] = useState(initialRoles);
  const [grants, setGrants] = useState(
    () =>
      new Set(
        initialRolePermissions.map((row) =>
          permissionPair(row.role_id, row.permission_id)
        )
      )
  );
  const [name, setName] = useState("");
  const [assignableWork, setAssignableWork] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    setNotice(null);

    if (!ROLE_NAME_PATTERN.test(normalizedName)) {
      setNotice({
        type: "error",
        text: "Use 1–32 lowercase letters, numbers, or underscores; start with a letter.",
      });
      return;
    }

    setBusyKey("create");
    const { data, error } = await supabase
      .from("roles")
      .insert({ name: normalizedName, assignable_work: assignableWork })
      .select("id, name, assignable_work, protected, hr_grantable")
      .single();

    if (error) {
      setNotice({
        type: "error",
        text:
          error.code === "23505"
            ? "A role with that name already exists."
            : error.message,
      });
    } else {
      setRoles((current) => [...current, data].sort((a, b) => a.id - b.id));
      setName("");
      setAssignableWork(false);
      setNotice({ type: "success", text: "Role created." });
    }
    setBusyKey(null);
  }

  async function toggleWorker(role: RoleOption) {
    if (role.protected) return;
    const key = `worker:${role.id}`;
    setBusyKey(key);
    setNotice(null);

    const { error } = await supabase
      .from("roles")
      .update({ assignable_work: !role.assignable_work })
      .eq("id", role.id);

    if (error) {
      setNotice({ type: "error", text: error.message });
    } else {
      setRoles((current) =>
        current.map((item) =>
          item.id === role.id
            ? { ...item, assignable_work: !item.assignable_work }
            : item
        )
      );
      setNotice({ type: "success", text: "Role saved." });
    }
    setBusyKey(null);
  }

  async function togglePermission(
    role: RoleOption,
    permission: PermissionOption
  ) {
    if (role.protected) return;
    const pair = permissionPair(role.id, permission.id);
    const currentlyGranted = grants.has(pair);
    setBusyKey(pair);
    setNotice(null);

    const query = currentlyGranted
      ? supabase
          .from("role_permissions")
          .delete()
          .eq("role_id", role.id)
          .eq("permission_id", permission.id)
      : supabase.from("role_permissions").insert({
          role_id: role.id,
          permission_id: permission.id,
        });
    const { error } = await query;

    if (error) {
      setNotice({ type: "error", text: error.message });
    } else {
      setGrants((current) => {
        const next = new Set(current);
        if (currentlyGranted) next.delete(pair);
        else next.add(pair);
        return next;
      });
      setNotice({ type: "success", text: "Permission saved." });
    }
    setBusyKey(null);
  }

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-brand-50 p-2 text-brand-700">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Roles &amp; permissions
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Changes apply immediately to every user who holds the role.
          </p>
        </div>
      </div>

      <Card className="mt-6 p-5">
        <h2 className="text-sm font-semibold text-slate-900">Create a role</h2>
        <form
          onSubmit={createRole}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <div className="min-w-[220px] flex-1">
            <Label>Role identifier</Label>
            <Input
              required
              maxLength={32}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="team_lead"
            />
            <p className="mt-1 text-xs text-slate-400">
              Lowercase letters, numbers, and underscores only.
            </p>
          </div>
          <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={assignableWork}
              onChange={(event) => setAssignableWork(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Can be assigned tasks
          </label>
          <Button type="submit" disabled={busyKey === "create"}>
            <Plus className="h-4 w-4" />
            {busyKey === "create" ? "Creating…" : "Create role"}
          </Button>
        </form>
      </Card>

      {notice && (
        <p
          className={`mt-4 text-sm ${
            notice.type === "error" ? "text-rose-600" : "text-emerald-600"
          }`}
        >
          {notice.text}
        </p>
      )}

      <div className="mt-4 space-y-4">
        {roles.map((role) => {
          const grantedKeys = new Set(
            permissions
              .filter((permission) =>
                grants.has(permissionPair(role.id, permission.id))
              )
              .map((permission) => permission.key)
          );
          const incomplete = [...grantedKeys].flatMap((key) => {
            const missing = (PERMISSION_DEPENDENCIES[key] ?? []).filter(
              (dependency) => !grantedKeys.has(dependency)
            );
            return missing.length
              ? [
                  `${PERMISSION_LABELS[key] ?? key} also needs ${missing
                    .map((item) => PERMISSION_LABELS[item] ?? item)
                    .join(" + ")}`,
                ]
              : [];
          });
          const managesLifecycle = [
            "user.promote",
            "user.archive",
            "user.manage_all",
          ].some((key) => grantedKeys.has(key));
          const transferMissing = ["task.view_all", "task.update"].filter(
            (key) => !grantedKeys.has(key)
          );
          const guidance =
            managesLifecycle && transferMissing.length > 0
              ? [
                  ...incomplete,
                  `Optional offboarding transfer also needs ${transferMissing
                    .map((item) => PERMISSION_LABELS[item] ?? item)
                    .join(" + ")}`,
                ]
              : incomplete;

          return (
            <Card key={role.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-slate-900">{role.name}</h2>
                    {role.protected && <Badge tone="brand">Protected</Badge>}
                    {role.hr_grantable && (
                      <Badge tone="neutral">HR grantable</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {role.protected
                      ? "This system role and its keyring are read-only."
                      : "Select the exact capabilities this role should hold."}
                  </p>
                </div>
                <label
                  className={`flex items-center gap-2 text-sm ${
                    role.protected
                      ? "cursor-not-allowed text-slate-400"
                      : "cursor-pointer text-slate-700"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={role.assignable_work}
                    disabled={role.protected || busyKey === `worker:${role.id}`}
                    onChange={() => toggleWorker(role)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  Can be assigned tasks
                </label>
              </div>

              {!role.protected && guidance.length > 0 && (
                <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <p className="font-medium">Permission bundle guidance</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {guidance.map((message) => (
                      <li key={message}>{message}.</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-5 border-t border-slate-100 pt-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <KeyRound className="h-3.5 w-3.5" />
                  Permission keyring
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {permissions.map((permission) => {
                    const pair = permissionPair(role.id, permission.id);
                    return (
                      <label
                        key={permission.id}
                        className={`flex items-start gap-2 rounded-lg border border-slate-100 px-3 py-2 ${
                          role.protected
                            ? "cursor-not-allowed bg-slate-50"
                            : "cursor-pointer hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={grants.has(pair)}
                          disabled={role.protected || busyKey === pair}
                          onChange={() => togglePermission(role, permission)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        <span>
                          <span className="block text-sm text-slate-700">
                            {PERMISSION_LABELS[permission.key] ?? permission.key}
                          </span>
                          <span className="block font-mono text-[11px] text-slate-400">
                            {permission.key}
                          </span>
                          {PERMISSION_NOTES[permission.key] && (
                            <span className="mt-0.5 block text-[11px] text-slate-500">
                              {PERMISSION_NOTES[permission.key]}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
