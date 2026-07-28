// Server Component: only role.manage holders may load the RBAC editor.
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import RolesClient from "./RolesClient";

export default async function RolesPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: canManage } = await supabase.rpc("has_permission", {
    perm: "role.manage",
  });
  if (!canManage) redirect("/dashboard");

  const [
    { data: roles },
    { data: permissions },
    { data: rolePermissions },
  ] = await Promise.all([
    supabase
      .from("roles")
      .select("id, name, assignable_work, protected, hr_grantable")
      .order("id"),
    supabase.from("permissions").select("id, key").order("key"),
    supabase
      .from("role_permissions")
      .select("role_id, permission_id"),
  ]);

  return (
    <RolesClient
      initialRoles={roles ?? []}
      permissions={permissions ?? []}
      initialRolePermissions={rolePermissions ?? []}
    />
  );
}
