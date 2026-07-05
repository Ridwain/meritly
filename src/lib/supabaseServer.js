// Server-side Supabase client.
// Use this in Server Components, Route Handlers (API routes), and middleware.
// It wires Supabase auth into Next.js cookies so the logged-in session is
// available on the server. Reads the public URL + anon key from the environment.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // In a plain Server Component you can't set cookies; that's fine to
          // ignore because middleware refreshes the session. This only needs to
          // succeed inside Route Handlers and middleware.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore.
          }
        },
      },
    }
  );
}
