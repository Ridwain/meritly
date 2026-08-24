import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { Card } from "@/components/ui/Card";
import { CheckCircle2, Printer, FileText, TrendingUp } from "lucide-react";

function roleLabel(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function DashboardOverview() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, roles(name, assignable_work)")
    .eq("id", user.id)
    .single();

  const role = profile?.roles as {
    name: string;
    assignable_work: boolean;
  } | null;
  const firstName = profile?.full_name?.split(" ")[0] ?? "there";

  const permissionKeys = [
    "task.view_all",
    "task.create",
    "submission.create",
    "submission.review",
    "stats.view_all",
    "user.invite",
    "user.promote",
    "user.archive",
    "user.manage_all",
    "role.manage",
  ] as const;
  const permissionResults = await Promise.all(
    permissionKeys.map((perm) => supabase.rpc("has_permission", { perm }))
  );
  const can = Object.fromEntries(
    permissionKeys.map((key, index) => [
      key,
      Boolean(permissionResults[index].data),
    ])
  ) as Record<(typeof permissionKeys)[number], boolean>;

  const items: string[] = [];
  if (role?.assignable_work) {
    items.push("View work assigned to you.");
    if (can["submission.create"]) {
      items.push("Start and submit your assigned work.");
    }
  }
  if (can["task.view_all"]) {
    items.push("View team tasks.");
  }
  if (can["task.view_all"] && can["task.create"]) {
    items.push("Assign work to team members.");
  }
  if (can["task.view_all"] && can["submission.review"]) {
    items.push("Review submitted work.");
  }
  if (can["stats.view_all"] && can["task.view_all"] && can["submission.review"]) {
    items.push("Track worker performance.");
  }
  if (can["user.invite"]) {
    items.push("Invite new users.");
  }
  if (can["user.manage_all"] || can["user.promote"] || can["user.archive"]) {
    items.push("Manage the users allowed by your role.");
  }
  if (can["role.manage"]) items.push("Manage roles and permission keyrings.");
  if (items.length === 0) items.push("View the sections available to your role.");

  // Fetch employees in HR's own department (HR only)
  let deptEmployees: { id: string; full_name: string }[] = [];
  let deptName = "";
  if (can["stats.view_all"]) {
    const { data: hrProfile } = await supabase
      .from("profiles")
      .select("department_id, departments(name)")
      .eq("id", user.id)
      .single();

    const dept = hrProfile?.departments as { name: string } | null;
    deptName = dept?.name ?? "your department";

    if (hrProfile?.department_id) {
      const { data: empRows } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("department_id", hrProfile.department_id)
        .is("deleted_at", null)
        .neq("id", user.id);
      deptEmployees = empRows ?? [];
    }
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Welcome back, {firstName}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          You&rsquo;re signed in as{" "}
          <span className="font-medium text-slate-700">
            {role ? roleLabel(role.name) : "Unknown role"}
          </span>.
        </p>
      </div>

      {/* What you can do */}
      <Card className="p-6">
        <h2 className="text-sm font-semibold text-slate-900">
          What you can do here
        </h2>
        <ul className="mt-3 space-y-2">
          {items.map((t) => (
            <li key={t} className="flex items-start gap-2 text-sm text-slate-600">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
              {t}
            </li>
          ))}
        </ul>
      </Card>

      {/* ── PRINT PERFORMANCE REPORT — HR only ──────────────────────────────
          This is a standalone feature card. HR can generate and print a
          full PDF performance report for any employee in their department.
          Employees from other departments are NOT accessible here.
      ─────────────────────────────────────────────────────────────────────── */}
      {can["stats.view_all"] && (
        <div className="rounded-xl border-2 border-brand-200 bg-gradient-to-br from-brand-50 to-white p-6 shadow-sm">

          {/* Feature header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* Big icon badge */}
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-600 shadow">
                <Printer className="h-6 w-6 text-white" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Print Employee Performance Report
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Generate a printable PDF report for employees in{" "}
                  <span className="font-medium text-slate-700">{deptName}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Feature description */}
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-brand-500" />
              Includes task completion stats
            </span>
            <span className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-brand-500" />
              On-time rate &amp; performance overview
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-brand-500" />
              Department-restricted access only
            </span>
          </div>

          {/* Divider */}
          <div className="my-4 border-t border-brand-100" />

          {/* Employee list */}
          {deptEmployees.length === 0 ? (
            <p className="text-sm text-slate-400">
              No employees found in your department yet.
            </p>
          ) : (
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Select an employee to generate their report
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {deptEmployees.map((emp) => (
                  <Link
                    key={emp.id}
                    href={`/dashboard/performance/print?emp=${emp.id}`}
                    className="group flex items-center gap-3 rounded-lg border border-brand-100 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition-all hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 hover:shadow"
                  >
                    {/* Avatar circle with initials */}
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                      {emp.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{emp.full_name}</span>
                    <Printer className="h-4 w-4 shrink-0 text-brand-400 opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
