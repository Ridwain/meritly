"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRightLeft,
  Building2,
  UserPlus,
  X,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { isValidEmail } from "@/lib/validation";
import type {
  AssignableEmployee,
  Department,
  LifecycleDialog,
  Notice,
  RoleOption,
  UserRow,
  UserWorkCounts,
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
  workCounts: Record<string, UserWorkCounts>;
  replacements: AssignableEmployee[];
  departments: Department[];
  viewerDepartmentId: number | null;
};

// Interactive user-management table. Role changes / archiving are plain profile
// UPDATEs sent with the browser client — the database's RLS + triggers decide
// what's actually allowed. Inviting needs the privileged API route.
export default function UsersTable({
  viewerId,
  viewerCaps,
  initialUsers,
  roles,
  workCounts,
  replacements,
  departments,
  viewerDepartmentId,
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
  const inviteDepartments = viewerCaps.manageAll
    ? departments
    : departments.filter((department) => department.id === viewerDepartmentId);
  const [inviteDepartmentId, setInviteDepartmentId] = useState(
    String(inviteDepartments[0]?.id ?? "")
  );
  const [inviting, setInviting] = useState(false);
  // <Notice | null> — the state is either a message or nothing.
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleDialog | null>(null);
  const [replacementId, setReplacementId] = useState("");
  const [reason, setReason] = useState("");
  const [departmentMove, setDepartmentMove] = useState<{
    requestId: string;
    user: UserRow;
  } | null>(null);
  const [destinationDepartmentId, setDestinationDepartmentId] = useState("");
  const [departmentReason, setDepartmentReason] = useState("");

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
      body: JSON.stringify({
        email,
        fullName,
        departmentId: Number(inviteDepartmentId),
      }),
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

  function openDepartmentMove(user: UserRow) {
    const firstDestination = departments.find(
      (department) => department.id !== user.department_id
    );
    setNotice(null);
    setDepartmentReason("");
    setDestinationDepartmentId(String(firstDestination?.id ?? ""));
    setDepartmentMove({ requestId: crypto.randomUUID(), user });
  }

  function closeDepartmentMove() {
    if (busyId) return;
    setDepartmentMove(null);
    setDestinationDepartmentId("");
    setDepartmentReason("");
  }

  async function confirmDepartmentMove() {
    if (!departmentMove) return;
    const cleanReason = departmentReason.trim();
    if (cleanReason.length < 3 || !destinationDepartmentId) return;

    setBusyId(departmentMove.user.id);
    setNotice(null);
    const { error } = await supabase.rpc("move_user_department", {
      p_request_id: departmentMove.requestId,
      p_target_user_id: departmentMove.user.id,
      p_new_department_id: Number(destinationDepartmentId),
      p_reason: cleanReason,
    });

    if (error) {
      setNotice({ type: "error", text: error.message });
      setBusyId(null);
      return;
    }

    setNotice({
      type: "success",
      text: `${departmentMove.user.full_name} moved to the selected department.`,
    });
    setDepartmentMove(null);
    setDestinationDepartmentId("");
    setDepartmentReason("");
    setBusyId(null);
    router.refresh();
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

  function openLifecycle(
    user: UserRow,
    action: LifecycleDialog["action"],
    targetRoleId: number | null = null
  ) {
    setNotice(null);
    setReplacementId("");
    setReason("");
    setLifecycle({
      // Keep this id while the dialog stays open so a retry is idempotent.
      requestId: crypto.randomUUID(),
      user,
      action,
      targetRoleId,
    });
  }

  function closeLifecycle() {
    if (busyId) return;
    setLifecycle(null);
    setReplacementId("");
    setReason("");
  }

  async function confirmLifecycle() {
    if (!lifecycle) return;
    const cleanReason = reason.trim();
    if (cleanReason.length < 3) {
      setNotice({
        type: "error",
        text: "Please enter a reason with at least 3 characters.",
      });
      return;
    }

    setBusyId(lifecycle.user.id);
    setNotice(null);
    const { data, error } = await supabase.rpc("offboard_user", {
      p_request_id: lifecycle.requestId,
      p_target_user_id: lifecycle.user.id,
      p_action: lifecycle.action,
      p_target_role_id: lifecycle.targetRoleId,
      p_replacement_user_id: replacementId || null,
      p_reason: cleanReason,
    });

    if (error) {
      // Keep the dialog and request id so the user can safely retry.
      setNotice({ type: "error", text: error.message });
      setBusyId(null);
      return;
    }

    const result = data?.[0];
    const actionLabel =
      lifecycle.action === "archive" ? "User archived" : "Role changed";
    setNotice({
      type: "success",
      text: result
        ? `${actionLabel}. ${result.reassigned_task_count} transferred, ${result.queued_task_count} awaiting reassignment, ${result.submitted_task_count} awaiting review.`
        : `${actionLabel}.`,
    });
    setLifecycle(null);
    setReplacementId("");
    setReason("");
    setBusyId(null);
    router.refresh();
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
          onChange={(event) => {
            const nextRoleId = Number(event.target.value);
            const nextRole = roles.find((role) => role.id === nextRoleId);
            if (targetRole.assignable_work && !nextRole?.assignable_work) {
              openLifecycle(u, "role_change", nextRoleId);
            } else {
              apply(u.id, { role_id: nextRoleId });
            }
          }}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
        >
          {nonProtectedRoles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      );
      if (departments.some((department) => department.id !== u.department_id)) {
        controls.push(
          <Button
            key="department"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => openDepartmentMove(u)}
          >
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Move
          </Button>
        );
      }
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
              openLifecycle(u, "role_change", Number(event.target.value));
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
          onClick={() => openLifecycle(u, "archive")}
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

  const lifecycleCounts = lifecycle
    ? (workCounts[lifecycle.user.id] ?? { transferable: 0, submitted: 0 })
    : { transferable: 0, submitted: 0 };
  const lifecycleTargetRole = lifecycle?.targetRoleId
    ? roles.find((role) => role.id === lifecycle.targetRoleId)
    : null;
  const canTransfer =
    viewerCaps.taskViewAll &&
    viewerCaps.taskUpdate &&
    lifecycleCounts.transferable > 0;

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
            <div className="min-w-[180px] flex-1">
              <Label>Department</Label>
              <select
                required
                value={inviteDepartmentId}
                onChange={(event) =>
                  setInviteDepartmentId(event.target.value)
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                {inviteDepartments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
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
                <th className="px-4 py-3 font-medium">Department</th>
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
                  <td className="px-4 py-3 text-slate-600">
                    {u.department_name}
                  </td>
                  <td className="px-4 py-3">{statusBadge(u)}</td>
                  <td className="px-5 py-3">{actionsFor(u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {lifecycle && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="lifecycle-title"
        >
          <Card className="w-full max-w-lg p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <div className="rounded-lg bg-amber-50 p-2 text-amber-700">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h2
                    id="lifecycle-title"
                    className="font-semibold text-slate-900"
                  >
                    {lifecycle.action === "archive"
                      ? `Archive ${lifecycle.user.full_name}?`
                      : `Move ${lifecycle.user.full_name} to ${lifecycleTargetRole?.name ?? "the selected role"}?`}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Access changes immediately. Historical work and authorship
                    remain available.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={closeLifecycle}
                disabled={Boolean(busyId)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {viewerCaps.taskViewAll ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Transferable work</p>
                  <p className="mt-1 text-xl font-semibold text-slate-900">
                    {lifecycleCounts.transferable}
                  </p>
                </div>
                <div className="rounded-lg bg-amber-50 p-3">
                  <p className="text-xs text-amber-700">Submitted for review</p>
                  <p className="mt-1 text-xl font-semibold text-amber-900">
                    {lifecycleCounts.submitted}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                Your role cannot inspect task counts. The account change can
                still continue; unresolved work will remain in management
                custody.
              </p>
            )}

            {canTransfer && (
              <div className="mt-4">
                <Label>Replacement worker (optional)</Label>
                <select
                  value={replacementId}
                  onChange={(event) => setReplacementId(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">Leave work in the reassignment queue</option>
                  {replacements
                    .filter((employee) => employee.id !== lifecycle.user.id)
                    .map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.full_name}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {lifecycleCounts.submitted > 0 && (
              <p className="mt-3 text-xs text-amber-700">
                Submitted work stays with the original employee for review and
                is never reassigned.
              </p>
            )}

            <div className="mt-4">
              <Label>Reason</Label>
              <textarea
                required
                rows={3}
                minLength={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why is this access change needed?"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            {notice?.type === "error" && (
              <p className="mt-2 text-sm text-rose-600">{notice.text}</p>
            )}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={closeLifecycle}
                disabled={Boolean(busyId)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={
                  lifecycle.action === "archive" ? "danger" : "primary"
                }
                onClick={confirmLifecycle}
                disabled={Boolean(busyId) || reason.trim().length < 3}
              >
                {busyId
                  ? "Saving…"
                  : replacementId
                    ? "Transfer and continue"
                    : lifecycle.action === "archive"
                      ? "Archive now"
                      : "Change role now"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {departmentMove && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="department-move-title"
        >
          <Card className="w-full max-w-md p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex gap-3">
                <div className="rounded-lg bg-brand-50 p-2 text-brand-700">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h2
                    id="department-move-title"
                    className="font-semibold text-slate-900"
                  >
                    Move {departmentMove.user.full_name}?
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Their current and historical work will immediately follow
                    the destination department&apos;s access boundary.
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={closeDepartmentMove}
                disabled={Boolean(busyId)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4">
              <Label>Destination department</Label>
              <select
                value={destinationDepartmentId}
                onChange={(event) =>
                  setDestinationDepartmentId(event.target.value)
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                {departments
                  .filter(
                    (department) =>
                      department.id !== departmentMove.user.department_id
                  )
                  .map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="mt-4">
              <Label>Reason</Label>
              <textarea
                required
                rows={3}
                minLength={3}
                maxLength={500}
                value={departmentReason}
                onChange={(event) => setDepartmentReason(event.target.value)}
                placeholder="Why is this department transfer needed?"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            {notice?.type === "error" && (
              <p className="mt-2 text-sm text-rose-600">{notice.text}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={closeDepartmentMove}
                disabled={Boolean(busyId)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={confirmDepartmentMove}
                disabled={
                  Boolean(busyId) ||
                  !destinationDepartmentId ||
                  departmentReason.trim().length < 3
                }
              >
                <ArrowRightLeft className="h-4 w-4" />
                {busyId ? "Moving…" : "Move department"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
