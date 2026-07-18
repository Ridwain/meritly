// Server Component: auth check + role-based shell. The interactive sidebar
// (active-link highlighting) lives in the client Sidebar component.
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type { RoleName } from "@/lib/types";
import Sidebar, { type NavItem } from "./Sidebar";

// Record<RoleName, ...> means adding a role to the union forces us to give it
// a nav list here — TypeScript won't let us forget.
const NAV_BY_ROLE: Record<RoleName, NavItem[]> = {
  employee: [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/my-tasks", label: "My Tasks" },
  ],
  hr: [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/tasks", label: "Tasks" },
    { href: "/dashboard/employees", label: "Employees" },
    { href: "/dashboard/performance", label: "Performance" },
    { href: "/dashboard/users", label: "Users" },
  ],
  // admin sees the same links as HR (the Users page exposes extra controls)
  admin: [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/tasks", label: "Tasks" },
    { href: "/dashboard/employees", label: "Employees" },
    { href: "/dashboard/performance", label: "Performance" },
    { href: "/dashboard/users", label: "Users" },
  ],
};

const ROLE_LABELS: Record<RoleName, string> = {
  employee: "Employee",
  hr: "HR",
  admin: "Admin",
};

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
    .select("full_name, deleted_at, roles(name)")
    .eq("id", user.id)
    .single();

  if (!profile || profile.deleted_at) redirect("/login?deactivated=1");

  // The DB gives us `string`; narrow it to our RoleName union.
  const role = (profile.roles as { name: string } | null)?.name as RoleName;
  const nav = NAV_BY_ROLE[role] ?? NAV_BY_ROLE.employee;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        nav={nav}
        user={{
          full_name: profile.full_name,
          roleLabel: ROLE_LABELS[role] ?? role,
        }}
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-6xl px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
