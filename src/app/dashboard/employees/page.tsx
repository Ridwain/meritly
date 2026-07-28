// Employees list (Server Component): HR/admin only. It prepares current and
// historical employee data; the client component handles status filtering.
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type {
  EmployeeSummary,
  HistoricalEmployee,
  TaskStatus,
  UserRow,
} from "@/lib/types";
import EmployeeCards from "./EmployeeCards";

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

  // Includes current workers plus promoted/archived people with durable work
  // history, so offboarding never removes the route back to their metrics.
  const [{ data: subjects }, { data: visibleUsers }] = await Promise.all([
    supabase.rpc("historical_employees"),
    supabase.rpc("admin_list_users"),
  ]);
  const emailById = new Map(
    ((visibleUsers ?? []) as UserRow[]).map((person) => [
      person.id,
      person.email,
    ])
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

  const employees: EmployeeSummary[] = (
    (subjects ?? []) as HistoricalEmployee[]
  ).map((subject) => ({
      id: subject.id,
      full_name: subject.full_name,
      // Email stays scoped by the existing user-list RPC; historical rows that
      // are outside that caller's user-management scope show no email.
      email: emailById.get(subject.id) ?? subject.email,
      role: subject.role,
      lifecycleStatus: subject.deleted_at
        ? "archived"
        : subject.current_assignable
          ? "active"
          : "promoted",
      hasHistory: subject.has_history,
      totalTasks: totalsByEmployee[subject.id]?.total ?? 0,
      completedTasks: totalsByEmployee[subject.id]?.completed ?? 0,
    }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Employees</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pick someone to see their performance over time.
        </p>
      </div>

      <EmployeeCards employees={employees} />
    </div>
  );
}
