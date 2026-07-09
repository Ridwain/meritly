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

  // Only the current user's own, non-archived tasks — soonest deadline first.
  // RLS (tasks_select) also guarantees an employee can't read anyone else's.
  const { data: tasks } = await supabase
    .from("tasks")
    .select(
      "id, title, description, priority, deadline, status, attachment_url, attachment_name, assigned_by"
    )
    .eq("assigned_to", user.id)
    .is("deleted_at", null)
    .order("deadline", { ascending: true });

  // Look up who assigned each task (for an "Assigned by …" line).
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name");
  const nameById = Object.fromEntries(
    (profiles ?? []).map((p) => [p.id, p.full_name])
  );

  const tasksWithNames = (tasks ?? []).map((t) => ({
    ...t,
    assigner_name: nameById[t.assigned_by] ?? "HR",
  }));

  return <MyTasksClient tasks={tasksWithNames} />;
}
