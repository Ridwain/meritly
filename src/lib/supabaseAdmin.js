// Admin (service-role) Supabase client.
// The service-role key BYPASSES Row Level Security — it is "god mode". It must
// NEVER reach the browser, so this file has no "use client" and reads a
// non-public env var. Only import it from server code (API routes), and always
// check the caller's permission FIRST before doing anything with it.
import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
