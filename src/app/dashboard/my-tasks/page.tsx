// Employee "My Tasks" page (Server Component).
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type { MyTask } from "@/lib/types";
import MyTasksClient from "./MyTasksClient";

export default async function MyTasksPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Ownership lets users read their assigned tasks. This separate capability
  // decides whether those tasks are actionable or read-only.
  const { data: canWork } = await supabase.rpc("has_permission", {
    perm: "submission.create",
  });

  // Flag any past-deadline tasks as overdue before we read them (Feature 8).
  await supabase.rpc("flag_overdue_tasks");

  // Only the current user's own, non-archived tasks — soonest deadline first.
  const { data: tasks } = await supabase
    .from("tasks")
    .select(
      "id, title, description, priority, deadline, status, attachment_path, attachment_name, assigned_by"
    )
    .eq("assigned_to", user.id)
    .is("deleted_at", null)
    .order("deadline", { ascending: true });

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name");
  const nameById: Record<string, string> = Object.fromEntries(
    (profiles ?? []).map((p) => [p.id, p.full_name])
  );

  // Latest submission per task — used to show HR's feedback on returned work.
  const { data: subs } = await supabase
    .from("submissions")
    .select("task_id, hr_feedback, submitted_at")
    .eq("employee_id", user.id)
    .order("submitted_at", { ascending: false });

  const latestByTask: Record<string, { hr_feedback: string | null }> = {};
  for (const s of subs ?? []) {
    if (!latestByTask[s.task_id]) latestByTask[s.task_id] = s; // first seen = latest
  }

  // The DB gives status/priority as plain `string` (we used CHECK constraints,
  // not enums), so cast to the narrowed MyTask shape here — one place.
  const tasksWithNames = (tasks ?? []).map((t) => ({
    ...t,
    assigner_name: nameById[t.assigned_by] ?? "HR",
    latest_feedback: latestByTask[t.id]?.hr_feedback ?? null,
  })) as MyTask[];

  return (
    <MyTasksClient
      tasks={tasksWithNames}
      userId={user.id}
      canWork={Boolean(canWork)}
    />
  );
}
