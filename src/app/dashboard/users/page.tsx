// User management page (Server Component). Capabilities, not role names, decide
// who enters and which controls the client renders.
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type { UserRow } from "@/lib/types";
import UsersTable from "./UsersTable";

export default async function UsersPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // The RPC accepts user-management capabilities and scopes non-full managers
  // to worker rows. A caller with none of those capabilities is rejected.
  const { data: users, error } = await supabase.rpc("admin_list_users");
  if (error) redirect("/dashboard");

  const [
    { data: canInvite },
    { data: canManageAll },
    { data: canPromote },
    { data: canArchive },
    { data: roles },
  ] = await Promise.all([
    supabase.rpc("has_permission", { perm: "user.invite" }),
    supabase.rpc("has_permission", { perm: "user.manage_all" }),
    supabase.rpc("has_permission", { perm: "user.promote" }),
    supabase.rpc("has_permission", { perm: "user.archive" }),
    supabase
      .from("roles")
      .select("id, name, assignable_work, protected, hr_grantable")
      .order("id"),
  ]);

  return (
    <UsersTable
      viewerId={user.id}
      viewerCaps={{
        invite: Boolean(canInvite),
        manageAll: Boolean(canManageAll),
        promote: Boolean(canPromote),
        archive: Boolean(canArchive),
      }}
      initialUsers={(users ?? []) as UserRow[]}
      roles={roles ?? []}
    />
  );
}
