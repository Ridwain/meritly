import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { Card } from "@/components/ui/Card";
import { CheckCircle2 } from "lucide-react";
import type { RoleName } from "@/lib/types";

const ROLE_LABELS: Record<RoleName, string> = {
  employee: "Employee",
  hr: "HR",
  admin: "Admin",
};

export default async function DashboardOverview() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, roles(name)")
    .eq("id", user.id)
    .single();

  const role = (profile?.roles as { name: string } | null)?.name as RoleName;
  const roleLabel = ROLE_LABELS[role] ?? role;
  const firstName = profile?.full_name?.split(" ")[0] ?? "there";

  const items: string[] =
    role === "employee"
      ? [
          "See tasks assigned to you under My Tasks.",
          "Start a task and submit your completed work.",
        ]
      : [
          "Assign and review tasks.",
          "Track each employee's performance.",
          role === "admin" ? "Manage users and roles." : "Manage users.",
        ];

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Welcome back, {firstName}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        You&rsquo;re signed in as{" "}
        <span className="font-medium text-slate-700">{roleLabel}</span>.
      </p>

      <Card className="mt-6 p-6">
        <h2 className="text-sm font-semibold text-slate-900">
          What you can do here
        </h2>
        <ul className="mt-3 space-y-2">
          {items.map((t) => (
            <li
              key={t}
              className="flex items-start gap-2 text-sm text-slate-600"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
              {t}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-400">
          These sections get built in the next features.
        </p>
      </Card>
    </div>
  );
}
