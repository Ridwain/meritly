"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabaseClient";

// Interactive user-management table. Role changes / archiving are plain
// profile UPDATEs sent with the browser client — the database's RLS + triggers
// decide what's actually allowed, so the buttons here are just convenience.
// (Inviting is different: it needs the privileged API route.)
export default function UsersTable({ viewer, initialUsers, roles }) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();

  const roleId = Object.fromEntries(roles.map((r) => [r.name, r.id]));

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [notice, setNotice] = useState(null); // { type, text }
  const [busyId, setBusyId] = useState(null);

  async function invite(e) {
    e.preventDefault();
    setInviting(true);
    setNotice(null);
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

  async function apply(userId, changes) {
    setBusyId(userId);
    setNotice(null);
    const { error } = await supabase
      .from("profiles")
      .update(changes)
      .eq("id", userId);
    if (error) {
      setNotice({ type: "error", text: error.message });
    } else {
      router.refresh();
    }
    setBusyId(null);
  }

  function statusBadge(u) {
    if (u.deleted_at)
      return <Badge color="red">Archived</Badge>;
    if (!u.has_password)
      return <Badge color="yellow">Invited</Badge>;
    return <Badge color="green">Active</Badge>;
  }

  // Which buttons a viewer sees for a given target (UI hint; RLS is the truth).
  function actionsFor(u) {
    if (u.id === viewer.id) return <span className="text-xs text-gray-400">You</span>;
    if (u.role === "admin") return <span className="text-xs text-gray-400">—</span>;

    const canManageEmployee =
      viewer.role === "admin" || viewer.role === "hr";
    const canManageHr = viewer.role === "admin";
    const buttons = [];

    if (u.deleted_at) {
      // Archived → only restore (if allowed for this target)
      if ((u.role === "employee" && canManageEmployee) || (u.role === "hr" && canManageHr)) {
        buttons.push(
          <ActionBtn key="restore" busy={busyId === u.id}
            onClick={() => apply(u.id, { deleted_at: null })}>Restore</ActionBtn>
        );
      }
    } else {
      // Active → role change + archive
      if (u.role === "employee" && canManageEmployee) {
        buttons.push(
          <ActionBtn key="promote" busy={busyId === u.id}
            onClick={() => apply(u.id, { role_id: roleId.hr })}>Promote to HR</ActionBtn>
        );
      }
      if (u.role === "hr" && canManageHr) {
        buttons.push(
          <ActionBtn key="demote" busy={busyId === u.id}
            onClick={() => apply(u.id, { role_id: roleId.employee })}>Demote</ActionBtn>
        );
      }
      if ((u.role === "employee" && canManageEmployee) || (u.role === "hr" && canManageHr)) {
        buttons.push(
          <ActionBtn key="archive" danger busy={busyId === u.id}
            onClick={() => apply(u.id, { deleted_at: new Date().toISOString() })}>Archive</ActionBtn>
        );
      }
    }
    return buttons.length ? <div className="flex gap-2">{buttons}</div> :
      <span className="text-xs text-gray-400">—</span>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">User management</h1>
      <p className="mt-1 text-sm text-gray-600">
        Invite people and manage their roles. New accounts always start as employees.
      </p>

      {/* Invite form */}
      <form onSubmit={invite} className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-600">Full name</label>
          <input required value={fullName} onChange={(e) => setFullName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-600">Email</label>
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
        </div>
        <button type="submit" disabled={inviting}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {inviting ? "Sending…" : "Send invite"}
        </button>
      </form>

      {notice && (
        <p className={`mt-3 text-sm ${notice.type === "error" ? "text-red-600" : "text-green-600"}`}>
          {notice.text}
        </p>
      )}

      {/* Users table */}
      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {initialUsers.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium text-gray-900">{u.full_name}</td>
                <td className="px-4 py-3 text-gray-600">{u.email}</td>
                <td className="px-4 py-3 capitalize">{u.role}</td>
                <td className="px-4 py-3">{statusBadge(u)}</td>
                <td className="px-4 py-3">{actionsFor(u)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badge({ color, children }) {
  const colors = {
    green: "bg-green-100 text-green-700",
    yellow: "bg-yellow-100 text-yellow-700",
    red: "bg-red-100 text-red-600",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

function ActionBtn({ children, onClick, busy, danger }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
        danger
          ? "bg-red-50 text-red-600 hover:bg-red-100"
          : "bg-blue-50 text-blue-700 hover:bg-blue-100"
      }`}
    >
      {children}
    </button>
  );
}
