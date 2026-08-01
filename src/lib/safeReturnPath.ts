// OAuth can send a user through the normal Meritly login page. This helper
// permits only same-origin paths, preventing an attacker from turning `next`
// into an open redirect to another website.
export function safeReturnPath(
  value: string | string[] | null | undefined,
  fallback = "/dashboard"
) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith("/")) return fallback;

  try {
    const base = new URL("https://meritly.local");
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
