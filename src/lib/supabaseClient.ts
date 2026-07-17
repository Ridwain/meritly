// Browser-side Supabase client.
// Use this in Client Components (files with "use client") for auth actions,
// queries, and realtime. It reads the public URL + anon key from the environment.
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

// <Database> makes every query typed: supabase.from("tasks").select() now
// returns rows shaped exactly like the tasks table.
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
