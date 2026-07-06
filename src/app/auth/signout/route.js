// Route Handler = a backend endpoint (no UI). The sign-out button in the
// dashboard layout POSTs here. We clear the Supabase session, then redirect
// back to /login.
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export async function POST(request) {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  // 303 => the browser follows with a GET (correct after a POST).
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
