// Shared app types.
//
// Why hand-written? We used CHECK constraints instead of Postgres enums, so the
// generated database types give us plain `string` for status/priority/role.
// These unions add the precision back, so a typo like "complete" is a compile
// error instead of a runtime bug.
import type { Tables } from "./database.types";

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "submitted"
  | "completed"
  | "needs_revision"
  | "overdue";

export type Priority = "high" | "medium" | "low";

export type RoleName = "admin" | "hr" | "employee";

// Table row shapes, straight from the generated schema types.
export type TaskRow = Tables<"tasks">;
export type ProfileRow = Tables<"profiles">;
export type SubmissionRow = Tables<"submissions">;

// A task as the UI uses it: the row, plus the joined-in display fields and the
// narrowed status/priority unions.
export type TaskForUi = Omit<TaskRow, "status" | "priority"> & {
  status: TaskStatus;
  priority: Priority;
};

// The subset of employee info the assignee dropdown needs.
export type AssignableEmployee = {
  id: string;
  full_name: string;
};

// A row returned by the admin_list_users() database function.
// `accepted` reflects profiles.accepted_at, set by our own app the moment the
// invitee actually submits their new-password form — NOT the moment they
// merely open the invite email (see accept/page.tsx for why that distinction
// matters: Supabase's invite link is itself a one-time login token).
export type UserRow = {
  id: string;
  full_name: string;
  role: RoleName;
  email: string;
  deleted_at: string | null;
  accepted: boolean;
};

// Who is looking at the Users page (decides which buttons render).
export type Viewer = {
  id: string;
  role: RoleName;
};

// A row from the roles table, as the UI needs it.
export type RoleOption = {
  id: number;
  name: string;
};

// Inline success/error message shown in the feature pages.
export type Notice = {
  type: "error" | "success";
  text: string;
};

// A task as the employee's "My Tasks" page shows it: the columns we select,
// plus the joined-in assigner name and the latest HR feedback.
export type MyTask = {
  id: string;
  title: string;
  description: string | null;
  priority: Priority;
  deadline: string;
  status: TaskStatus;
  attachment_url: string | null;
  attachment_name: string | null;
  assigned_by: string;
  assigner_name: string;
  latest_feedback: string | null;
};

// The latest submission for a task, as HR's review panel needs it.
export type LatestSubmission = {
  id: string;
  task_id: string;
  note: string;
  file_url: string | null;
  hr_feedback: string | null;
  submitted_at: string;
};

// A task as HR's Tasks page shows it: the columns we select, plus the
// joined-in assignee name and the latest submission for the review panel.
export type HrTask = {
  id: string;
  title: string;
  description: string | null;
  assigned_to: string;
  priority: Priority;
  deadline: string;
  status: TaskStatus;
  created_at: string;
  attachment_url: string | null;
  attachment_name: string | null;
  assignee_name: string;
  latest_submission: LatestSubmission | null;
};
