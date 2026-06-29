/**
 * Email-domain allowlist for the Google login gate. Pure, dependency-free, and
 * Edge-safe so it can be unit-tested in isolation and reused from better-auth's
 * `databaseHooks` without pulling in the native database module.
 */

const DEFAULT_ALLOWED_DOMAIN = "nalbam.com";

/**
 * Parse the comma-separated `AUTH_ALLOWED_DOMAINS` env value into a normalized
 * lowercase list. An unset/blank value falls back to the single default domain.
 */
export function parseAllowedDomains(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") {
    return [DEFAULT_ALLOWED_DOMAIN];
  }
  return raw
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);
}

/**
 * True only when `email`'s domain matches one of `allowedDomains` exactly.
 * Subdomains do not match (`a@sub.nalbam.com` is rejected against `nalbam.com`).
 */
export function isEmailAllowed(
  email: string | null | undefined,
  allowedDomains: string[],
): boolean {
  if (!email) {
    return false;
  }
  const at = email.lastIndexOf("@");
  if (at < 0) {
    return false;
  }
  const domain = email.slice(at + 1).toLowerCase();
  if (domain.length === 0) {
    return false;
  }
  return allowedDomains.includes(domain);
}
