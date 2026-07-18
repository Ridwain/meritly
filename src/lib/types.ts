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
