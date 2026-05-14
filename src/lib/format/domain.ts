const DOMAIN_RE = /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/**
 * Normalise an operator-typed custom domain. Returns null for empty / null /
 * undefined input. Throws on malformed input so server actions can surface a
 * clear error before hitting the DB.
 */
export function normaliseCustomDomain(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") return null;
  if (trimmed.length > 253) {
    throw new Error("custom domain must be 253 characters or fewer");
  }
  if (!DOMAIN_RE.test(trimmed)) {
    throw new Error(
      "custom domain must be a bare hostname like app.example.com (no protocol, no path)",
    );
  }
  return trimmed;
}
