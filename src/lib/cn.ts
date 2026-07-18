// Tiny helper to join class names, skipping falsy values.
// e.g. cn("base", isActive && "active", className)
//
// The type says: accept strings or any falsy value (so `cond && "x"` works),
// and always return a string.
type ClassValue = string | false | null | undefined;

export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
