// Server Component: auth check + role-based shell. The interactive sidebar
// (active-link highlighting) lives in the client Sidebar component.
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import Sidebar from "./Sidebar";

const NAV_BY_ROLE = {
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
};
NAV_BY_ROLE.admin = NAV_BY_ROLE.hr;

const ROLE_LABELS = { employee: "Employee", hr: "HR", admin: "Admin" };

export default async function DashboardLayout({ children }) {
  const supabase = createSupabaseServerClient();

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

  const role = profile.roles.name;
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
