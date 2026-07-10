// Employee "My Tasks" page (Server Component).
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import MyTasksClient from "./MyTasksClient";

export default async function MyTasksPage() {
  const supabase = createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Flag any past-deadline tasks as overdue before we read them (Feature 8).
  await supabase.rpc("flag_overdue_tasks");

  // Only the current user's own, non-archived tasks — soonest deadline first.
  const { data: tasks } = await supabase
    .from("tasks")
    .select(
      "id, title, description, priority, deadline, status, attachment_url, attachment_name, assigned_by"
    )
    .eq("assigned_to", user.id)
    .is("deleted_at", null)
    .order("deadline", { ascending: true });

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name");
  const nameById = Object.fromEntries(
    (profiles ?? []).map((p) => [p.id, p.full_name])
  );

  // Latest submission per task — used to show HR's feedback on returned work.
  const { data: subs } = await supabase
    .from("submissions")
    .select("task_id, hr_feedback, submitted_at")
    .eq("employee_id", user.id)
    .order("submitted_at", { ascending: false });
  const latestByTask = {};
  for (const s of subs ?? []) {
    if (!latestByTask[s.task_id]) latestByTask[s.task_id] = s; // first seen = latest
  }

  const tasksWithNames = (tasks ?? []).map((t) => ({
    ...t,
    assigner_name: nameById[t.assigned_by] ?? "HR",
    latest_feedback: latestByTask[t.id]?.hr_feedback ?? null,
  }));

  return <MyTasksClient tasks={tasksWithNames} userId={user.id} />;
}
