// /dashboard/performance/print
//
// This is a special "print-friendly" page.
// When HR opens this page for an employee, they see a clean sheet with:
//   - Employee name, role, department
//   - 4 performance stats (total tasks, completed, completion rate, on-time rate)
//   - A list of all their tasks with status and deadline
//
// HR can only print employees from their OWN department.
// If they try another department's employee, they get an error.
//
// The page has a "Print / Save as PDF" button at the top.
// When clicked, the browser opens its print dialog — HR can save as PDF from there.
// The sidebar and nav are hidden when printing (via CSS print styles).

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { computeRates } from "@/lib/stats";
import type { TaskStatus } from "@/lib/types";
import PrintButton from "./PrintButton";

// Format a date like "Aug 14, 2026"
function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Give each task status a readable label
const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  submitted: "Submitted",
  completed: "Completed",
  needs_revision: "Needs Revision",
  overdue: "Overdue",
};

export default async function PrintPerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ emp?: string }>;
}) {
  const { emp } = await searchParams;
  const supabase = await createSupabaseServerClient();

  // ── Step 1: Check the viewer is logged in ──────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // ── Step 2: Check the viewer has stats.view_all permission (HR only) ───────
  const { data: canView } = await supabase.rpc("has_permission", {
    perm: "stats.view_all",
  });
  if (!canView) redirect("/dashboard");

  // ── Step 3: Make sure an employee ID was provided ──────────────────────────
  if (!emp) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        No employee selected.{" "}
        <a href="/dashboard/employees" className="text-brand-600 hover:underline">
          Go to Employees
        </a>
      </div>
    );
  }

  // ── Step 4: Get HR's own department ───────────────────────────────────────
  // HR can only print employees who are in the SAME department as them.
  const { data: hrProfile } = await supabase
    .from("profiles")
    .select("department_id")
    .eq("id", user.id)
    .single();

  const hrDepartmentId = hrProfile?.department_id;

  // ── Step 5: Get the target employee's profile ──────────────────────────────
  const { data: empProfile } = await supabase
    .from("profiles")
    .select("full_name, department_id, deleted_at, roles(name), departments(name)")
    .eq("id", emp)
    .single();

  if (!empProfile) {
    return (
      <div className="p-8 text-center text-sm text-slate-500">
        Employee not found.
      </div>
    );
  }

  // ── Step 6: Block if employee is from a different department ───────────────
  if (empProfile.department_id !== hrDepartmentId) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm font-semibold text-rose-600">Access Denied</p>
        <p className="mt-1 text-sm text-slate-500">
          You can only print performance sheets for employees in your own department.
        </p>
        <a
          href="/dashboard/employees"
          className="mt-4 inline-block text-sm text-brand-600 hover:underline"
        >
          Back to Employees
        </a>
      </div>
    );
  }

  // ── Step 7: Fetch the employee's tasks ────────────────────────────────────
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, status, priority, deadline")
    .eq("assigned_to", emp)
    .is("deleted_at", null)
    .order("deadline", { ascending: true });

  // ── Step 8: Fetch submissions for on-time rate calculation ────────────────
  const { data: submissions } = await supabase
    .from("submissions")
    .select("task_id, submitted_at")
    .eq("employee_id", emp);

  // ── Step 9: Calculate performance stats ───────────────────────────────────
  const rates = computeRates(
    (tasks ?? []).map((t) => ({ ...t, status: t.status as TaskStatus })),
    submissions ?? []
  );

  const role = empProfile.roles as { name: string } | null;
  const dept = empProfile.departments as { name: string } | null;
  const printedOn = new Date().toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <>
      {/*
        Print styles: hide the button when printing so it doesn't show on the PDF.
        The sidebar is already hidden because this page is inside the dashboard
        layout — we use a special wrapper below to override that for print.
      */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="mx-auto max-w-2xl space-y-6 p-6">

        {/* ── TOP BAR: back link + print button (hidden when printing) ─────── */}
        <div className="no-print flex items-center justify-between">
          <a
            href={`/dashboard/performance?emp=${emp}`}
            className="text-sm text-brand-600 hover:underline"
          >
            ← Back to Performance
          </a>
          {/* PrintButton is a client component — just calls window.print() */}
          <PrintButton />
        </div>

        {/* ── HEADER ────────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                Performance Report
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Printed on {printedOn}
              </p>
            </div>
            {/* Company / app name */}
            <div className="text-right">
              <p className="text-lg font-bold text-brand-600">Meritly</p>
              <p className="text-xs text-slate-400">Work Monitoring System</p>
            </div>
          </div>

          {/* Employee info */}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Employee
            </p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {empProfile.full_name}
            </p>
            <div className="mt-1 flex flex-wrap gap-4 text-sm text-slate-500">
              <span>Role: <span className="font-medium text-slate-700 capitalize">{role?.name ?? "—"}</span></span>
              <span>Department: <span className="font-medium text-slate-700">{dept?.name ?? "—"}</span></span>
              <span>Status: <span className="font-medium text-slate-700">{empProfile.deleted_at ? "Archived" : "Active"}</span></span>
            </div>
          </div>
        </div>

        {/* ── STATS GRID ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Total Tasks", value: rates.totalTasks },
            { label: "Completed", value: rates.completedTasks },
            { label: "Completion Rate", value: `${rates.completionRate}%` },
            { label: "On-Time Rate", value: `${rates.onTimeRate}%` },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <p className="text-xs font-medium text-slate-500">{stat.label}</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* ── TASK LIST ─────────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">
              All Tasks ({tasks?.length ?? 0})
            </h2>
          </div>

          {!tasks || tasks.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No tasks assigned yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2">Task</th>
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Deadline</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task, i) => (
                  <tr
                    key={task.id}
                    className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}
                  >
                    <td className="px-5 py-2 font-medium text-slate-800">
                      {task.title}
                    </td>
                    <td className="px-3 py-2 capitalize text-slate-500">
                      {task.priority}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {STATUS_LABEL[task.status] ?? task.status}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {formatDate(task.deadline)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── FOOTER ────────────────────────────────────────────────────────── */}
        <p className="text-center text-xs text-slate-400">
          This report was generated by Meritly · {printedOn}
        </p>
      </div>
    </>
  );
}
