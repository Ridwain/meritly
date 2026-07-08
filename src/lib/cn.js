// Tiny helper to join class names, skipping falsy values.
// e.g. cn("base", isActive && "active", className)
export function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}
