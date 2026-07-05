// Browser-side Supabase client.
// Use this in Client Components (files with "use client") for auth actions,
// queries, and realtime. It reads the public URL + anon key from the environment.
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
