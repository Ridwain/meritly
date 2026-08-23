import { createSupabaseServerClient } from "@/lib/supabaseServer";
import DocumentsClient from "./DocumentsClient";

export default async function DocumentsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("roles(name)")
    .eq("id", user.id)
    .single();

  const roleData = profile?.roles as { name: string } | null;
  const userRole = roleData?.name || "employee";

  return <DocumentsClient userRole={userRole} />;
}