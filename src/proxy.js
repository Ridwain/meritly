// Next.js 16 renamed the "middleware" file convention to "proxy".
// Same idea: this runs before a matching request reaches a page — here it
// refreshes the Supabase session and bounces logged-out visitors off /dashboard.
import { updateSession } from "@/lib/supabaseMiddleware";

export async function proxy(request) {
  return await updateSession(request);
}

export const config = {
  // Run on everything EXCEPT static assets and image files (they don't need
  // an auth check, and skipping them keeps the app fast).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
