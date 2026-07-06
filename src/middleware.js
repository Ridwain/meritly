// Next.js looks for this file automatically and runs it on matching requests.
import { updateSession } from "@/lib/supabaseMiddleware";

export async function middleware(request) {
  return await updateSession(request);
}

export const config = {
  // Run on everything EXCEPT static assets and image files (they don't need
  // an auth check, and skipping them keeps the app fast).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
