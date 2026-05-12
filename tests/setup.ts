// Vitest global setup. Populates env.ts's required variables with safe
// fake values so importing src/lib/* doesn't crash. Tests that need a
// real DB or real OAuth would override these per-suite.

process.env.DATABASE_URL ??=
  "postgresql://test:test@localhost:5432/test?sslmode=disable";
process.env.NEXTAUTH_SECRET ??=
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.NEXTAUTH_URL ??= "http://localhost:3000";
process.env.GITHUB_OAUTH_CLIENT_ID ??= "test-client-id";
process.env.GITHUB_OAUTH_CLIENT_SECRET ??= "test-client-secret";
process.env.ALLOWED_EMAIL ??= `test${String.fromCharCode(0x40)}example.com`;
process.env.ENCRYPTION_KEY ??=
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
process.env.DEPLOYOPS_LIVE ??= "0";

// Web Crypto is on globalThis.crypto in Node 18+, no shim needed.
