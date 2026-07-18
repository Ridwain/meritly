// Pure, framework-free math for the Performance dashboard (Feature 9).
// No Supabase calls and no React here — just data in, numbers out. That
// makes the rules easy to read (and to unit-test later) in isolation from
// where the data comes from or how it's rendered.
import type { ActivityRow, PerformanceRates, TaskStatus } from "./types";

type TaskForRates = {
  id: string;
  status: TaskStatus;
  deadline: string;
};

type SubmissionForRates = {
  task_id: string;
  submitted_at: string;
};

// completionRate = completed / total tasks.
// onTimeRate = of the tasks that were ever submitted, how many had their
// LATEST (most recent) submission at or before the CURRENT deadline. Both
// sides of that comparison track "what's true right now": if HR reviews a
// late submission and pushes the deadline back, and the employee's next
// resubmission beats the new deadline, that counts as on time — the earlier
// miss against the old deadline no longer applies, since the deadline
// itself was renegotiated.
// Both rates are 0 (never NaN) when their denominator is 0 — an employee
// with no tasks yet, or no submissions yet, should show 0%, not a crash.
export function computeRates(
  tasks: TaskForRates[],
  submissions: SubmissionForRates[]
): PerformanceRates {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "completed").length;

  const latestSubmittedAt = new Map<string, number>();
  for (const s of submissions) {
    const time = new Date(s.submitted_at).getTime();
    const existing = latestSubmittedAt.get(s.task_id);
    if (existing === undefined || time > existing) {
      latestSubmittedAt.set(s.task_id, time);
    }
  }

  const deadlineByTask = new Map(
    tasks.map((t) => [t.id, new Date(t.deadline).getTime()])
  );

  let submittedCount = 0;
  let onTimeCount = 0;
  for (const [taskId, submittedAt] of latestSubmittedAt) {
    const deadline = deadlineByTask.get(taskId);
    if (deadline === undefined) continue; // submission outside this task set
    submittedCount += 1;
    if (submittedAt <= deadline) onTimeCount += 1;
  }

  return {
    totalTasks,
    completedTasks,
    completionRate:
      totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100),
    onTimeRate:
      submittedCount === 0 ? 0 : Math.round((onTimeCount / submittedCount) * 100),
  };
}

export type TrendPoint = {
  date: string; // short label for the chart's x-axis, e.g. "Jul 5"
  count: number;
};

// Buckets activity events into one count per day, for the last `days` days
// ending today. This must run in the BROWSER, not on the server: "today"
// and each day's start/end boundary have to be the viewer's own local
// calendar day. Date.toDateString()/setDate() use whatever timezone the
// JS engine is running in, so calling this from a "use client" component
// (see PerformanceChart.tsx) automatically makes it the viewer's timezone.
export function bucketActivityByDay(rows: ActivityRow[], days: number): TrendPoint[] {
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();

  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    const key = day.toDateString();
    counts.set(key, 0);
    labels.set(key, day.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  }

  for (const row of rows) {
    const key = new Date(row.created_at).toDateString();
    if (counts.has(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  return [...counts.entries()].map(([key, count]) => ({
    date: labels.get(key)!,
    count,
  }));
}
