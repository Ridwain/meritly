// The dashboard "Overview" landing page (Server Component).
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export default async function DashboardOverview() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, roles(name)")
    .eq("id", user.id)
    .single();

  const role = profile?.roles?.name;
  const roleLabel = { employee: "Employee", hr: "HR", admin: "Admin" }[role] ?? role;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">
        Welcome, {profile?.full_name} 👋
      </h1>
      <p className="mt-2 text-gray-600">
        You are signed in as{" "}
        <span className="font-semibold">{roleLabel}</span>.
      </p>

      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="font-semibold text-gray-900">What you can do here</h2>
        {role === "employee" ? (
          <ul className="mt-2 list-inside list-disc text-sm text-gray-600">
            <li>See tasks assigned to you under “My Tasks”.</li>
            <li>Start a task and submit your completed work.</li>
          </ul>
        ) : (
          <ul className="mt-2 list-inside list-disc text-sm text-gray-600">
            <li>Assign and review tasks.</li>
            <li>Track each employee’s performance.</li>
            <li>Manage users{role === "admin" ? " and roles" : ""}.</li>
          </ul>
        )}
        <p className="mt-4 text-xs text-gray-400">
          These sections get built in the next features.
        </p>
      </div>
    </div>
  );
}
