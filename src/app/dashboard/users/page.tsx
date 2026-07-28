// User management page (Server Component). Capabilities, not role names, decide
// who enters and which controls the client renders.
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type {
  AssignableEmployee,
  TaskStatus,
  UserRow,
  UserWorkCounts,
} from "@/lib/types";
import UsersTable from "./UsersTable";

export default async function UsersPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: users, error },
    { data: canInvite },
    { data: canManageAll },
    { data: canPromote },
    { data: canArchive },
    { data: canTaskViewAll },
    { data: canTaskUpdate },
    { data: roles },
  ] = await Promise.all([
    // The RPC scopes non-full managers to worker rows.
    supabase.rpc("admin_list_users"),
    supabase.rpc("has_permission", { perm: "user.invite" }),
    supabase.rpc("has_permission", { perm: "user.manage_all" }),
    supabase.rpc("has_permission", { perm: "user.promote" }),
    supabase.rpc("has_permission", { perm: "user.archive" }),
    supabase.rpc("has_permission", { perm: "task.view_all" }),
    supabase.rpc("has_permission", { perm: "task.update" }),
    supabase
      .from("roles")
      .select("id, name, assignable_work, protected, hr_grantable")
      .order("id"),
  ]);
  if (error) redirect("/dashboard");

  const canReadWork = Boolean(canTaskViewAll);
  const canTransferWork = canReadWork && Boolean(canTaskUpdate);

  const [{ data: workRows }, { data: replacements }] = await Promise.all([
    canReadWork
      ? supabase
          .from("tasks")
          .select("assigned_to, status")
          .is("deleted_at", null)
          .neq("status", "completed")
      : Promise.resolve({ data: [] }),
    canTransferWork
      ? supabase.rpc("assignable_employees")
      : Promise.resolve({ data: [] }),
  ]);

  const workCounts: Record<string, UserWorkCounts> = {};
  for (const task of workRows ?? []) {
    const counts = (workCounts[task.assigned_to] ??= {
      transferable: 0,
      submitted: 0,
    });
    if ((task.status as TaskStatus) === "submitted") counts.submitted += 1;
    else counts.transferable += 1;
  }

  return (
    <UsersTable
      viewerId={user.id}
      viewerCaps={{
        invite: Boolean(canInvite),
        manageAll: Boolean(canManageAll),
        promote: Boolean(canPromote),
        archive: Boolean(canArchive),
        taskViewAll: canReadWork,
        taskUpdate: Boolean(canTaskUpdate),
      }}
      initialUsers={(users ?? []) as UserRow[]}
      roles={roles ?? []}
      workCounts={workCounts}
      replacements={(replacements ?? []) as AssignableEmployee[]}
    />
  );
}
