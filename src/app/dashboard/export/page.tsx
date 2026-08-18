// Export Page (Server Component): Auth guard, permission guard, and data fetching.
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type { EmployeeSummary, HistoricalEmployee, TaskStatus, UserRow } from "@/lib/types";
import ExportClient from "./ExportClient";

export default async function ExportPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Re-use stats.view_all permission to gate access to performance export reports.
  const { data: allowed } = await supabase.rpc("has_permission", {
    perm: "stats.view_all",
  });
  if (!allowed) redirect("/dashboard");

  // Fetch employees list (with emails & stats)
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

  // Fetch task summary count per employee
  const { data: summaryTasks } = await supabase
    .from("tasks")
    .select("assigned_to, status")
    .is("deleted_at", null);

  const totalsByEmployee: Record<string, { total: number; completed: number }> = {};
  for (const t of summaryTasks ?? []) {
    const bucket = (totalsByEmployee[t.assigned_to] ??= { total: 0, completed: 0 });
    bucket.total += 1;
    if ((t.status as TaskStatus) === "completed") bucket.completed += 1;
  }

  const employees: EmployeeSummary[] = (
    (subjects ?? []) as HistoricalEmployee[]
  ).map((subject) => ({
    id: subject.id,
    full_name: subject.full_name,
    email: emailById.get(subject.id) ?? subject.email,
    role: subject.role,
    departmentId: subject.department_id,
    departmentName: subject.department_name,
    lifecycleStatus: subject.deleted_at
      ? "archived"
      : subject.current_assignable
        ? "active"
        : "promoted",
    hasHistory: subject.has_history,
    totalTasks: totalsByEmployee[subject.id]?.total ?? 0,
    completedTasks: totalsByEmployee[subject.id]?.completed ?? 0,
  }));

  // Fetch raw tasks details for CSV export
  const { data: rawTasks } = await supabase
    .from("tasks")
    .select("id, title, description, assigned_to, assigned_by, priority, deadline, status, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name");
  
  const nameById = Object.fromEntries(
    (profiles ?? []).map((p) => [p.id, p.full_name])
  );

  const tasks = (rawTasks ?? []).map((t) => ({
    title: t.title,
    description: t.description || "N/A",
    assignee: nameById[t.assigned_to] || "Unknown",
    assigner: nameById[t.assigned_by] || "Unknown",
    priority: t.priority,
    deadline: t.deadline,
    status: t.status,
    created_at: t.created_at,
  }));

  return (
    <ExportClient
      employees={employees}
      tasks={tasks}
    />
  );
}
