"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { isValidEmail } from "@/lib/validation";
import type {
  Notice,
  RoleOption,
  UserRow,
  ViewerCapabilities,
} from "@/lib/types";

// What a profile UPDATE may change from this screen. The database's triggers
// still decide if it's allowed — this just describes the shape we send.
type ProfileChanges = {
  role_id?: number;
  deleted_at?: string | null;
};

export type UsersTableProps = {
  viewerId: string;
  viewerCaps: ViewerCapabilities;
  initialUsers: UserRow[];
  roles: RoleOption[];
};

// Interactive user-management table. Role changes / archiving are plain profile
// UPDATEs sent with the browser client — the database's RLS + triggers decide
// what's actually allowed. Inviting needs the privileged API route.
export default function UsersTable({
  viewerId,
  viewerCaps,
  initialUsers,
  roles,
}: UsersTableProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const roleByName = new Map(roles.map((role) => [role.name, role]));
  const nonProtectedRoles = roles.filter((role) => !role.protected);
  const hrGrantableRoles = roles.filter(
    (role) => !role.protected && role.hr_grantable
  );

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [inviting, setInviting] = useState(false);
  // <Notice | null> — the state is either a message or nothing.
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setNotice(null);
    if (!isValidEmail(email)) {
      setNotice({ type: "error", text: "Invalid email." });
      return;
    }
    setInviting(true);
    const res = await fetch("/api/invite-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, fullName }),
    });
    const body = await res.json();
    if (!res.ok) {
      setNotice({ type: "error", text: body.error || "Invite failed." });
    } else {
      setNotice({ type: "success", text: `Invitation emailed to ${email}.` });
      setEmail("");
      setFullName("");
      router.refresh();
    }
    setInviting(false);
  }

  async function apply(userId: string, changes: ProfileChanges) {
    setBusyId(userId);
    setNotice(null);
    const { error } = await supabase
      .from("profiles")
      .update(changes)
      .eq("id", userId);
    if (error) setNotice({ type: "error", text: error.message });
    else router.refresh();
    setBusyId(null);
  }

  function statusBadge(u: UserRow): ReactNode {
    if (u.deleted_at) return <Badge tone="neutral">Archived</Badge>;
    if (!u.accepted) return <Badge tone="warning">Invited</Badge>;
    return <Badge tone="success">Active</Badge>;
  }

  // Which buttons a viewer sees for a target (UI hint; RLS is the real gate).
  function actionsFor(u: UserRow): ReactNode {
    if (u.id === viewerId)
      return <span className="text-xs text-slate-400">You</span>;
    const targetRole = roleByName.get(u.role);
    if (!targetRole || targetRole.protected)
      return <span className="text-xs text-slate-400">—</span>;

    const busy = busyId === u.id;
    const controls: ReactNode[] = [];

    if (viewerCaps.manageAll) {
      controls.push(
        <select
          key="role"
          aria-label={`Role for ${u.full_name}`}
          value={targetRole.id}
          disabled={busy}
          onChange={(event) =>
            apply(u.id, { role_id: Number(event.target.value) })
          }
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          {nonProtectedRoles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      );
    } else if (
      viewerCaps.promote &&
      targetRole.assignable_work &&
      !u.deleted_at &&
      hrGrantableRoles.length > 0
    ) {
      controls.push(
        <select
          key="promote"
          aria-label={`Promote ${u.full_name}`}
          defaultValue=""
          disabled={busy}
          onChange={(event) => {
            if (event.target.value) {
              apply(u.id, { role_id: Number(event.target.value) });
            }
          }}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          <option value="" disabled>
            Promote…
          </option>
          {hrGrantableRoles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      );
    }

    if (u.deleted_at) {
      if (
        viewerCaps.manageAll ||
        (viewerCaps.archive && targetRole.assignable_work)
      ) {
        controls.push(
          <Button
            key="restore"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => apply(u.id, { deleted_at: null })}
          >
            Restore
          </Button>
        );
      }
    } else if (
      viewerCaps.manageAll ||
      (viewerCaps.archive && targetRole.assignable_work)
    ) {
      controls.push(
        <Button
          key="archive"
          variant="danger"
          size="sm"
          disabled={busy}
          onClick={() =>
            apply(u.id, { deleted_at: new Date().toISOString() })
          }
        >
          Archive
        </Button>
      );
    }

    return controls.length ? (
      <div className="flex flex-wrap justify-end gap-2">{controls}</div>
    ) : (
      <span className="text-xs text-slate-400">—</span>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        User management
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Invite people and manage access. New accounts start in the employee
        role.
      </p>

      {viewerCaps.invite && (
        <Card className="mt-6 p-5">
          <form onSubmit={invite} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <Label>Full name</Label>
              <Input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Sara Karim"
              />
            </div>
            <div className="min-w-[180px] flex-1">
              <Label>Email</Label>
              <Input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
              />
            </div>
            <Button type="submit" disabled={inviting}>
              <UserPlus className="h-4 w-4" />
              {inviting ? "Sending…" : "Send invite"}
            </Button>
          </form>
          {notice && (
            <p
              className={`mt-3 text-sm ${
                notice.type === "error" ? "text-rose-600" : "text-emerald-600"
              }`}
            >
              {notice.text}
            </p>
          )}
        </Card>
      )}
      {!viewerCaps.invite && notice && (
        <p
          className={`mt-4 text-sm ${
            notice.type === "error" ? "text-rose-600" : "text-emerald-600"
          }`}
        >
          {notice.text}
        </p>
      )}

      <Card className="mt-4 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {initialUsers.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/60">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={u.full_name} className="h-8 w-8" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">
                          {u.full_name}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {u.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-600">
                    {u.role}
                  </td>
                  <td className="px-4 py-3">{statusBadge(u)}</td>
                  <td className="px-5 py-3">{actionsFor(u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
