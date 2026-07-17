// Server-side Supabase client.
// Use this in Server Components, Route Handlers (API routes), and middleware.
// It wires Supabase auth into Next.js cookies so the logged-in session is
// available on the server. Reads the public URL + anon key from the environment.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

// Async because Next.js 15+ made cookies() return a Promise — so every caller
// must `await createSupabaseServerClient()`.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // In a plain Server Component you can't set cookies; that's fine to
          // ignore because the proxy refreshes the session. This only needs to
          // succeed inside Route Handlers and the proxy.
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
