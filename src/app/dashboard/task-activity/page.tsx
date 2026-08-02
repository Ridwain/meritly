// Task Activity — Server Component (data fetch + auth guard).
// All the interactive UI lives in TaskActivityClient.tsx (same folder).
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import TaskActivityClient from "./TaskActivityClient";
import type { Priority, TaskStatus } from "@/lib/types";

// ─── types local to this feature ────────────────────────────────────────────

export type CommentRow = {
  id: string;
  task_id: string;
  author_id: string;
  author_name: string;
  body: string;
  ai_generated: boolean;
  created_at: string;
};

export type ActivityTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  deadline: string;
  assigned_to: string;
  assignee_name: string;
  // Latest submission (for HR AI-review panel)
  submission_id: string | null;
  submission_note: string | null;
  submission_file_path: string | null;
  comments: CommentRow[];
};

// ─── page ────────────────────────────────────────────────────────────────────

export default async function TaskActivityPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Who can do what?
  const [
    { data: canViewAll },
    { data: canReview },
    { data: canWork },
  ] = await Promise.all([
    supabase.rpc("has_permission", { perm: "task.view_all" }),
    supabase.rpc("has_permission", { perm: "submission.review" }),
    supabase.rpc("has_permission", { perm: "submission.create" }),
  ]);

  const isHr = Boolean(canViewAll);

  // HR/admin see every non-archived task; employees see only their own.
  const taskQuery = supabase
    .from("tasks")
    .select("id, title, description, status, priority, deadline, assigned_to")
    .is("deleted_at", null)
    .order("deadline", { ascending: true });

  if (!isHr) {
    taskQuery.eq("assigned_to", user.id);
  }

  const { data: tasks } = await taskQuery;

  // Name map for display (all profiles visible to authenticated users via RLS)
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name");
  const nameById: Record<string, string> = Object.fromEntries(
    (profiles ?? []).map((p) => [p.id, p.full_name])
  );

  // Latest submission per task
  const taskIds = (tasks ?? []).map((t) => t.id);
  let latestSubs: Record<
    string,
    { id: string; note: string; file_path: string | null }
  > = {};
  if (taskIds.length > 0 && isHr) {
    const { data: subs } = await supabase
      .from("submissions")
      .select("id, task_id, note, file_path, submitted_at")
      .in("task_id", taskIds)
      .order("submitted_at", { ascending: false });

    for (const s of subs ?? []) {
      if (!latestSubs[s.task_id]) latestSubs[s.task_id] = s;
    }
  }

  // Comments for all visible tasks
  let commentsByTask: Record<string, CommentRow[]> = {};
  if (taskIds.length > 0) {
    const { data: comments } = await supabase
      .from("task_comments")
      .select("id, task_id, author_id, body, ai_generated, created_at")
      .in("task_id", taskIds)
      .order("created_at", { ascending: true });

    for (const c of comments ?? []) {
      if (!commentsByTask[c.task_id]) commentsByTask[c.task_id] = [];
      commentsByTask[c.task_id].push({
        ...c,
        author_name: nameById[c.author_id] ?? "Unknown",
      });
    }
  }

  const activityTasks: ActivityTask[] = (tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status as TaskStatus,
    priority: t.priority as Priority,
    deadline: t.deadline,
    assigned_to: t.assigned_to,
    assignee_name: nameById[t.assigned_to] ?? "Unknown",
    submission_id: latestSubs[t.id]?.id ?? null,
    submission_note: latestSubs[t.id]?.note ?? null,
    submission_file_path: latestSubs[t.id]?.file_path ?? null,
    comments: commentsByTask[t.id] ?? [],
  }));

  return (
    <TaskActivityClient
      tasks={activityTasks}
      currentUserId={user.id}
      currentUserName={nameById[user.id] ?? "You"}
      isHr={isHr}
      canReview={Boolean(canReview)}
      canWork={Boolean(canWork)}
    />
  );
}
