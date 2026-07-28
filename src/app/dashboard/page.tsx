import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { Card } from "@/components/ui/Card";
import { CheckCircle2 } from "lucide-react";

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
  if (
    can["stats.view_all"] &&
    can["task.view_all"] &&
    can["submission.review"]
  ) {
    items.push("Track worker performance.");
  }
  if (can["user.invite"]) {
    items.push("Invite new users.");
  }
  if (
    can["user.manage_all"] ||
    can["user.promote"] ||
    can["user.archive"]
  ) {
    items.push("Manage the users allowed by your role.");
  }
  if (can["role.manage"]) items.push("Manage roles and permission keyrings.");
  if (items.length === 0) items.push("View the sections available to your role.");

  return (
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
      </Card>
    </div>
  );
}
