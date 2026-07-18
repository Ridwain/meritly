// Route Handler = a backend endpoint (no UI). The sign-out button in the
// dashboard layout POSTs here. We clear the Supabase session, then redirect
// back to /login.
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  // 303 => the browser follows with a GET (correct after a POST).
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
