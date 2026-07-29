// Department administration page. The server verifies the permission before
// rendering; table RLS repeats the same check for every browser write.
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type { Department } from "@/lib/types";
import DepartmentsClient from "./DepartmentsClient";

export default async function DepartmentsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: allowed } = await supabase.rpc("has_permission", {
    perm: "department.manage",
  });
  if (!allowed) redirect("/dashboard");

  const [{ data: departments }, { data: profiles }] = await Promise.all([
    supabase.from("departments").select("*").order("name"),
    supabase.from("profiles").select("department_id"),
  ]);

  const memberCounts: Record<number, number> = {};
  for (const profile of profiles ?? []) {
    memberCounts[profile.department_id] =
      (memberCounts[profile.department_id] ?? 0) + 1;
  }

  return (
    <DepartmentsClient
      initialDepartments={(departments ?? []) as Department[]}
      memberCounts={memberCounts}
    />
  );
}
