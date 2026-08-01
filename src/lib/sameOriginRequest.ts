import type { NextRequest } from "next/server";

function firstForwardedValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || null;
}

/**
 * Accept browser form POSTs only when their Origin matches Meritly's effective
 * public host. `nextUrl.origin` alone can contain an internal dev/proxy host.
 */
export function isTrustedSameOrigin(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  // Fetch Metadata is browser-controlled. A `same-origin` value is stronger
  // evidence than proxy-derived URL fields, which can expose an internal host.
  if (fetchSite === "same-origin") return true;
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return false;

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }

  const host =
    firstForwardedValue(request.headers.get("x-forwarded-host")) ??
    request.headers.get("host");
  const protocol =
    firstForwardedValue(request.headers.get("x-forwarded-proto")) ??
    request.nextUrl.protocol.replace(":", "");

  const allowedOrigins = new Set([request.nextUrl.origin]);
  if (host && (protocol === "http" || protocol === "https")) {
    allowedOrigins.add(`${protocol}://${host}`);
  }

  return allowedOrigins.has(normalizedOrigin);
}
