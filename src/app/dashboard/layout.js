// Server Component: runs on the server for every /dashboard/* page.
// It checks who you are, blocks archived accounts, and draws the sidebar
// that matches your role.
import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

// Which sidebar links each role sees.
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
// Admin sees the same links as HR (the Users page will expose extra
// admin-only controls later).
NAV_BY_ROLE.admin = NAV_BY_ROLE.hr;

// Friendly display names ("HR" not "Hr").
const ROLE_LABELS = { employee: "Employee", hr: "HR", admin: "Admin" };

export default async function DashboardLayout({ children }) {
  const supabase = createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login"); // belt-and-suspenders with the middleware

  // Read our own profile. RLS lets us read our own row even if archived,
  // which is exactly how we detect the archived case here.
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, deleted_at, roles(name)")
    .eq("id", user.id)
    .single();

  // Archived (or somehow missing) => no dashboard access. RLS already blocks
  // their data; this blocks the UI too (enforced, not just cosmetic).
  if (!profile || profile.deleted_at) redirect("/login?deactivated=1");

  const role = profile.roles.name;
  const nav = NAV_BY_ROLE[role] ?? NAV_BY_ROLE.employee;

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="flex w-60 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-200 p-4">
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-600">
            Meritly
          </p>
          <p className="mt-2 truncate text-sm font-medium text-gray-900">
            {profile.full_name}
          </p>
          <span className="mt-1 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
            {ROLE_LABELS[role] ?? role}
          </span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* A plain form POST to our sign-out route handler — no client JS needed. */}
        <form action="/auth/signout" method="post" className="border-t border-gray-200 p-3">
          <button
            type="submit"
            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Sign out
          </button>
        </form>
      </aside>

      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
