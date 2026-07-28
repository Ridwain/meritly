// Employees list (Server Component): HR/admin only. A quick-scan picker
// that links each employee into their own /dashboard/performance page.
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { EmployeeSummary, TaskStatus, UserRow } from "@/lib/types";

export default async function EmployeesPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Same permission that gates the Performance page — someone who can't
  // view stats has no reason to be looking at this list either.
  const { data: canView } = await supabase.rpc("has_permission", {
    perm: "stats.view_all",
  });
  if (!canView) redirect("/dashboard");

  // The RPC scopes limited viewers to workers. Full managers may receive every
  // role, so the role flags below remain the single source of worker truth.
  const [{ data: users }, { data: roles }] = await Promise.all([
    supabase.rpc("admin_list_users"),
    supabase.from("roles").select("name, assignable_work"),
  ]);
  const workerRoleNames = new Set(
    (roles ?? [])
      .filter((role) => role.assignable_work)
      .map((role) => role.name)
  );

  // Tasks not archived, so we can total up completed/total per employee.
  const { data: tasks } = await supabase
    .from("tasks")
    .select("assigned_to, status")
    .is("deleted_at", null);

  const totalsByEmployee: Record<string, { total: number; completed: number }> = {};
  for (const t of tasks ?? []) {
    const bucket = (totalsByEmployee[t.assigned_to] ??= { total: 0, completed: 0 });
    bucket.total += 1;
    if ((t.status as TaskStatus) === "completed") bucket.completed += 1;
  }

  // Only employees who accepted their invite: anyone still pending can't
  // have been assigned a task yet (enforced by is_assignable_employee() in
  // migration 10), so they would always show 0/0 — filtering them out here
  // keeps this list meaningfully about performance, not invite status
  // (that's what the Users page is for).
  const employees: EmployeeSummary[] = ((users ?? []) as UserRow[])
    .filter((u) => workerRoleNames.has(u.role) && u.accepted)
    .map((u) => ({
      id: u.id,
      full_name: u.full_name,
      email: u.email,
      totalTasks: totalsByEmployee[u.id]?.total ?? 0,
      completedTasks: totalsByEmployee[u.id]?.completed ?? 0,
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Employees</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pick someone to see their performance over time.
        </p>
      </div>

      {employees.length === 0 ? (
        <Card className="p-8 text-center text-sm text-slate-500">
          No employees have accepted their invite yet.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map((e) => (
            <Link key={e.id} href={`/dashboard/performance?emp=${e.id}`}>
              <Card className="flex items-center gap-3 p-4 transition-colors hover:border-brand-300 hover:bg-brand-50/40">
                <Avatar name={e.full_name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {e.full_name}
                  </p>
                  <p className="truncate text-xs text-slate-500">{e.email}</p>
                </div>
                <Badge tone={e.totalTasks === 0 ? "neutral" : "brand"}>
                  {e.completedTasks}/{e.totalTasks}
                </Badge>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
