// Performance dashboard (Server Component): one employee's stats + trend.
// Employees see only their own; HR/admin pick who via ?emp=<id>.
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { computeRates } from "@/lib/stats";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import type { ActivityRow, TaskStatus } from "@/lib/types";
import PerformanceChart from "./PerformanceChart";

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ emp?: string }>;
}) {
  const { emp } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: canViewAll } = await supabase.rpc("has_permission", {
    perm: "stats.view_all",
  });

  // The security boundary lives here, not just in the sidebar: an employee
  // who types ?emp=<someone-else> in the URL is ignored and always sees
  // their own id. Only stats.view_all holders may target another id, and
  // if they haven't picked anyone yet, send them to the picker.
  const targetId = canViewAll ? emp : user.id;
  if (!targetId) redirect("/dashboard/employees");

  // The RPC accepts current workers or people with durable work history. It
  // rejects arbitrary staff ids, while keeping archived/promoted employees
  // reachable from the historical picker.
  const { data: canOpenTarget } = await supabase.rpc(
    "can_view_performance_subject",
    { target: targetId }
  );
  if (!canOpenTarget) {
    return (
      <Card className="p-8 text-center text-sm text-slate-500">
        Employee not found.{" "}
        {canViewAll && (
          <Link href="/dashboard/employees" className="text-brand-600 hover:underline">
            Back to Employees
          </Link>
        )}
      </Card>
    );
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, deleted_at, roles(name, assignable_work)")
    .eq("id", targetId)
    .single();

  if (profileError || !profile) {
    return (
      <Card className="p-8 text-center text-sm text-slate-500">
        Employee not found.
      </Card>
    );
  }

  const targetRole = profile.roles as {
    name: string;
    assignable_work: boolean;
  } | null;
  const historyState = profile.deleted_at
    ? "Archived"
    : targetRole?.assignable_work
      ? null
      : "Promoted";

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, status, deadline")
    .eq("assigned_to", targetId)
    .is("deleted_at", null);

  const { data: submissions } = await supabase
    .from("submissions")
    .select("task_id, submitted_at")
    .eq("employee_id", targetId);

  const { data: activity } = await supabase
    .from("activity_log")
    .select("event, created_at")
    .eq("employee_id", targetId);

  const rates = computeRates(
    (tasks ?? []).map((t) => ({ ...t, status: t.status as TaskStatus })),
    submissions ?? []
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar name={profile.full_name} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-900">
                {profile.full_name}
              </h1>
              {historyState && (
                <Badge tone={historyState === "Archived" ? "neutral" : "warning"}>
                  {historyState}
                </Badge>
              )}
            </div>
            <p className="text-sm text-slate-500">Performance overview</p>
          </div>
        </div>
        {canViewAll && (
          <Link
            href="/dashboard/employees"
            className="text-sm font-medium text-brand-600 hover:underline"
          >
            Back to Employees
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total tasks" value={rates.totalTasks} />
        <StatTile label="Completed" value={rates.completedTasks} />
        <StatTile label="Completion rate" value={`${rates.completionRate}%`} />
        <StatTile label="On-time rate" value={`${rates.onTimeRate}%`} />
      </div>

      <Card className="p-5">
        <h2 className="mb-4 text-sm font-medium text-slate-900">
          Activity, last 14 days
        </h2>
        <PerformanceChart activity={(activity ?? []) as ActivityRow[]} />
      </Card>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
    </Card>
  );
}
