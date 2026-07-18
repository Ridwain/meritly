// Shared validation rules. Used by both the invite form (instant feedback)
// and the invite API route (the real enforcement — the API can be called
// directly, so it can never trust the form alone). One definition here means
// the two checks can't quietly drift apart.

// Deliberately NOT a full RFC 5322 email validator (those are notoriously
// complex and still let plenty of nonsense through) — just enough to catch
// real typos: something before an @, something after it, and a dot in the
// domain part.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}
