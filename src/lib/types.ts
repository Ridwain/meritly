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

// activity_log.event reuses the TaskStatus vocabulary — every status a task
// can be in is also an event worth logging.
export type ActivityEvent = TaskStatus;

// Table row shapes, straight from the generated schema types.
export type TaskRow = Tables<"tasks">;
export type ProfileRow = Tables<"profiles">;
export type SubmissionRow = Tables<"submissions">;

export type NotificationKind =
  | "task_assigned"
  | "task_reassigned"
  | "work_submitted"
  | "work_approved"
  | "revision_requested";

// Only the fields needed by the dropdown leave the server. Internal actor and
// task UUIDs stay in the database because the UI does not need them.
export type NotificationItem = {
  id: string;
  kind: NotificationKind;
  title: string;
  message: string;
  href: "/dashboard/my-tasks" | "/dashboard/tasks";
  read_at: string | null;
  created_at: string;
};

export type Department = {
  id: number;
  name: string;
  protected: boolean;
  created_at: string;
  updated_at: string;
};

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
  role: string;
  email: string;
  deleted_at: string | null;
  accepted: boolean;
  department_id: number;
  department_name: string;
};

// Capabilities decide which controls render. Role names are deliberately absent
// so a custom role works as soon as its permission keyring changes.
export type ViewerCapabilities = {
  invite: boolean;
  manageAll: boolean;
  promote: boolean;
  archive: boolean;
  taskViewAll: boolean;
  taskUpdate: boolean;
};

export type UserWorkCounts = {
  transferable: number;
  submitted: number;
};

export type OffboardAction = "archive" | "role_change";

export type LifecycleDialog = {
  requestId: string;
  user: UserRow;
  action: OffboardAction;
  targetRoleId: number | null;
};

// A row from the roles table, as the UI needs it.
export type RoleOption = {
  id: number;
  name: string;
  assignable_work: boolean;
  protected: boolean;
  hr_grantable: boolean;
};

export type PermissionOption = {
  id: number;
  key: string;
};

export type RolePermissionRow = {
  role_id: number;
  permission_id: number;
};

export type TaskCapabilities = {
  create: boolean;
  update: boolean;
  archive: boolean;
  review: boolean;
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
  attachment_path: string | null;
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
  file_path: string | null;
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
  attachment_path: string | null;
  attachment_name: string | null;
  assignee_name: string;
  latest_submission: LatestSubmission | null;
  custody_category: "needs_reassignment" | "needs_review" | null;
  assignee_state: "archived" | "unaccepted" | "non_worker" | "unknown" | null;
};

// One employee row on the Employees list (Feature 9): identity plus a quick
// completed/total count so HR can scan performance before drilling in.
export type EmployeeSummary = {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  departmentId: number;
  departmentName: string;
  lifecycleStatus: "active" | "promoted" | "archived";
  hasHistory: boolean;
  totalTasks: number;
  completedTasks: number;
};

export type HistoricalEmployee = {
  id: string;
  full_name: string;
  role: string;
  email: string | null;
  deleted_at: string | null;
  accepted: boolean;
  current_assignable: boolean;
  has_history: boolean;
  department_id: number;
  department_name: string;
};

// The two rates shown as KPI tiles on the Performance page. Both are 0 (not
// NaN) when there is no data yet — see computeRates() in lib/stats.ts.
export type PerformanceRates = {
  totalTasks: number;
  completedTasks: number;
  completionRate: number; // percent, 0-100
  onTimeRate: number; // percent of *submitted* tasks that beat their deadline
};

// One raw activity_log row, as read for the trend chart. The chart buckets
// these by day itself (client-side, so bucketing uses the viewer's own
// timezone — see PerformanceChart.tsx).
export type ActivityRow = {
  event: ActivityEvent;
  created_at: string;
};
