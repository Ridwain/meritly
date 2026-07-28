// HR/admin Tasks page (Server Component): guard + data fetch.
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type {
  AssignableEmployee,
  HrTask,
  LatestSubmission,
} from "@/lib/types";
import TasksClient from "./TasksClient";

export default async function TasksPage() {
  const supabase = await createSupabaseServerClient();

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

  const [
    { data: canCreate },
    { data: canUpdate },
    { data: canArchive },
    { data: canReview },
  ] = await Promise.all([
    supabase.rpc("has_permission", { perm: "task.create" }),
    supabase.rpc("has_permission", { perm: "task.update" }),
    supabase.rpc("has_permission", { perm: "task.archive" }),
    supabase.rpc("has_permission", { perm: "submission.review" }),
  ]);
  const capabilities = {
    create: Boolean(canCreate),
    update: Boolean(canUpdate),
    archive: Boolean(canArchive),
    review: Boolean(canReview),
  };

  // Flag any past-deadline tasks as overdue before we read them (Feature 8).
  await supabase.rpc("flag_overdue_tasks");

  // All active (non-archived) tasks, newest first.
  const { data: tasks } = await supabase
    .from("tasks")
    .select(
      "id, title, description, assigned_to, priority, deadline, status, created_at, attachment_url, attachment_name"
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  // Names for display (assignee column can include archived/old people).
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name");
  const nameById: Record<string, string> = Object.fromEntries(
    (profiles ?? []).map((p) => [p.id, p.full_name])
  );

  // Dropdown: only workers who are active AND accepted their invite
  // (set a password). The DB function enforces the same rule as the
  // tasks_insert policy, so the UI and the security rule can't drift.
  const { data: employees } =
    capabilities.create || capabilities.update
      ? await supabase.rpc("assignable_employees")
      : { data: [] };

  // Latest submission per task — the review panel shows the newest one.
  // RLS lets HR (submission.review) read every submission.
  const { data: subs } = capabilities.review
    ? await supabase
        .from("submissions")
        .select("id, task_id, note, file_url, hr_feedback, submitted_at")
        .order("submitted_at", { ascending: false })
    : { data: [] };

  const latestByTask: Record<string, LatestSubmission> = {};
  for (const s of subs ?? []) {
    if (!latestByTask[s.task_id]) latestByTask[s.task_id] = s;
  }

  // Cast to the narrowed HrTask shape here — the DB types give status/priority
  // as plain `string` because we used CHECK constraints rather than enums.
  const tasksWithNames = (tasks ?? []).map((t) => ({
    ...t,
    assignee_name: nameById[t.assigned_to] ?? "Unknown",
    latest_submission: latestByTask[t.id] ?? null,
  })) as HrTask[];

  return (
    <TasksClient
      tasks={tasksWithNames}
      employees={(employees ?? []) as AssignableEmployee[]}
      currentUserId={user.id}
      capabilities={capabilities}
    />
  );
}
