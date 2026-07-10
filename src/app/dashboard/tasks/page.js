// HR/admin Tasks page (Server Component): guard + data fetch.
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import TasksClient from "./TasksClient";

export default async function TasksPage() {
  const supabase = createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Only task.view_all holders (HR/admin) may see this page. Employees, who
  // lack that permission, get sent back to their dashboard.
  const { data: canView } = await supabase.rpc("has_permission", {
    perm: "task.view_all",
  });
  if (!canView) redirect("/dashboard");

  // All active (non-archived) tasks, newest first.
  const { data: tasks } = await supabase
    .from("tasks")
    .select(
      "id, title, description, assigned_to, priority, deadline, status, created_at, attachment_url, attachment_name"
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  // Fetch every profile once: used both to show assignee names and to build
  // the dropdown of assignable (active) employees.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, deleted_at, roles(name)");

  const nameById = Object.fromEntries(
    (profiles ?? []).map((p) => [p.id, p.full_name])
  );
  const employees = (profiles ?? [])
    .filter((p) => p.roles?.name === "employee" && !p.deleted_at)
    .map((p) => ({ id: p.id, full_name: p.full_name }));

  // Latest submission per task — the review panel shows the newest one.
  // RLS lets HR (submission.review) read every submission.
  const { data: subs } = await supabase
    .from("submissions")
    .select("id, task_id, note, file_url, hr_feedback, submitted_at")
    .order("submitted_at", { ascending: false });
  const latestByTask = {};
  for (const s of subs ?? []) {
    if (!latestByTask[s.task_id]) latestByTask[s.task_id] = s;
  }

  const tasksWithNames = (tasks ?? []).map((t) => ({
    ...t,
    assignee_name: nameById[t.assigned_to] ?? "Unknown",
    latest_submission: latestByTask[t.id] ?? null,
  }));

  return (
    <TasksClient
      tasks={tasksWithNames}
      employees={employees}
      currentUserId={user.id}
    />
  );
}
