// Server Component: auth check + capability-based shell. The interactive sidebar
// (active-link highlighting) lives in the client Sidebar component.
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import Sidebar, { type NavItem } from "./Sidebar";

function roleLabel(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, deleted_at, accepted_at, roles(name, assignable_work)")
    .eq("id", user.id)
    .single();

  if (!profile || profile.deleted_at) redirect("/login?deactivated=1");

  // Opening the invite link already creates a valid login session (Supabase's
  // invite link IS a one-time login token) — but that is not the same as
  // having finished onboarding. Send anyone who hasn't submitted the
  // "set your password" form yet back to finish it, instead of letting them
  // into the dashboard on an unfinished account.
  if (!profile.accepted_at) redirect("/auth/accept");

  const role = profile.roles as {
    name: string;
    assignable_work: boolean;
  } | null;

  const permissionKeys = [
    "task.view_all",
    "stats.view_all",
    "user.invite",
    "user.manage_all",
    "user.promote",
    "user.archive",
    "role.manage",
    "department.manage",
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

  const nav: NavItem[] = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/connected-apps", label: "Connected Apps" },
  ];
  if (role?.assignable_work) {
    nav.push({ href: "/dashboard/my-tasks", label: "My Tasks" });
  }
  if (can["task.view_all"]) {
    nav.push({ href: "/dashboard/tasks", label: "Tasks" });
  }
  // Task Activity is visible to everyone who can touch tasks — both HR and employees.
  if (can["task.view_all"] || role?.assignable_work) {
    nav.push({ href: "/dashboard/task-activity", label: "Task Activity" });
  }
  if (can["stats.view_all"]) {
    nav.push({ href: "/dashboard/employees", label: "Employees" });
    nav.push({ href: "/dashboard/export", label: "Export Report" });
  }
  if (
    can["user.invite"] ||
    can["user.manage_all"] ||
    can["user.promote"] ||
    can["user.archive"]
  ) {
    nav.push({ href: "/dashboard/users", label: "Users" });
  }
  if (can["role.manage"]) {
    nav.push({ href: "/dashboard/roles", label: "Roles" });
  }
  if (can["department.manage"]) {
    nav.push({ href: "/dashboard/departments", label: "Departments" });
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        nav={nav}
        user={{
          full_name: profile.full_name,
          roleLabel: role ? roleLabel(role.name) : "Unknown role",
        }}
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
