// User management page (Server Component). HR + admin only.
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import type { RoleName, UserRow } from "@/lib/types";
import UsersTable from "./UsersTable";

export default async function UsersPage() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // admin_list_users() itself checks the user.invite permission and throws if
  // the caller lacks it — so a plain employee hitting this URL gets bounced.
  const { data: users, error } = await supabase.rpc("admin_list_users");
  if (error) redirect("/dashboard");

  // Viewer's own role decides which buttons render.
  const { data: role } = await supabase.rpc("my_role");

  // Role id/name pairs so the client can map "hr" -> id when promoting.
  const { data: roles } = await supabase.from("roles").select("id, name");

  return (
    <UsersTable
      viewer={{ id: user.id, role: role as RoleName }}
      initialUsers={(users ?? []) as UserRow[]}
      roles={roles ?? []}
    />
  );
}
