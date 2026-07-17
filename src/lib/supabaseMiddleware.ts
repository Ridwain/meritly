// Proxy (formerly middleware) Supabase client.
// This runs on the Edge before a page renders. Its job here:
//   1. keep the login session fresh (refresh the auth cookie), and
//   2. bounce logged-out visitors away from /dashboard.
// The cookie juggling below is the official @supabase/ssr pattern: we must
// copy refreshed auth cookies onto BOTH the request (so this pass sees them)
// and the response (so the browser stores them).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() revalidates the token with Supabase (don't trust
  // getSession() here — it doesn't verify the JWT).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Guard the dashboard: no user => send to login.
  if (!user && request.nextUrl.pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
