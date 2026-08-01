// Server Component: bounce an already-logged-in visitor straight to the
// dashboard — the mirror image of the check in dashboard/layout.tsx (which
// sends signed-OUT visitors here). Doing this on the server, before any
// client JS runs, is what stops the login form from flashing back up after
// you're already signed in (e.g. via the browser Back button).
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabaseServer";
import { safeReturnPath } from "@/lib/safeReturnPath";
import LoginForm from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const returnPath = safeReturnPath(next);
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(returnPath);

  return <LoginForm returnPath={returnPath} />;
}
