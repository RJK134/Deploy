# DeployOps Console — Session 2 prompt

You are picking up DeployOps Console at the end of Session 1. Session 1 shipped
a Next.js 14 App Router app with auth, an email allowlist, a verified Neon DB
connection, and a styled empty dashboard with placeholder pages. PR #2 is
merged to `main`. The two real products this console will manage are
`RJK134/herm-platform` and `RJK134/EquiSmile`. This is a private, single-user
tool.

This session — Session 2 — turns the Connection Center placeholder into a
working credential vault. By the end, the operator can paste three provider
tokens, see them encrypted at rest, and watch the dashboard reflect verified
state. **Real provider API calls (Octokit, Vercel SDK, Neon API) still don't
land yet — they ship in Session 3.**

# Project context

- Stack from Session 1 stays: Next.js 14 App Router, TypeScript strict, Tailwind +
  shadcn/ui (slate base, mint primary), NextAuth v5 with GitHub provider and JWT
  sessions, Drizzle + `@neondatabase/serverless`, pnpm, Geist via the `geist`
  package, lucide-react.
- All eight tables already exist; only `provider_credentials.kind` enum
  changes this session.
- Env validator, middleware gating, dashboard sidebar+header, and the four KPI
  cards on `/` are already in place. Reuse them; do not refactor them in
  passing.

# Hard constraints

- **Do not call any GitHub, Vercel, or Neon provider API in this session.**
  Verification is a stub that proves the encrypt/decrypt roundtrip works and
  flips the connection state. Real probes ship in Session 3.
- **Encryption MUST use Web Crypto (`crypto.subtle`), not Node `crypto`.** The
  helper will eventually be imported from server actions and route handlers
  that may run on the Edge. No `Buffer`, no `crypto` from `node:crypto`.
- **Plaintext credentials must never leave the server.** No server action
  returns plaintext. No log line includes plaintext. The only thing the
  client sees is `last_four` and `connection_state`.
- **Every privileged mutation writes one `audit_log` row** with `actor` =
  signed-in email, `action` = verb (`credential.set` etc.), `target` = the
  affected `kind`.
- **Stay in dry-run.** `DEPLOYOPS_LIVE` is still `0`. Session 5+ flips it.
- **GitHub App is deferred to Session 5.** Session 2 stores a fine-grained
  PAT under `kind='github_pat'`. Schema enum is updated accordingly.
- Same as Session 1: read all secrets from `process.env` via the existing
  `src/lib/env.ts`, fail fast if missing, never commit `.env` files.

# Schema delta

One change to `provider_credentials.kind` enum:

```diff
- kind text not null check in ('github_app','vercel','neon')
+ kind text not null check in ('github_pat','vercel','neon')
```

No data migration is needed (no rows exist yet). Run `pnpm db:push` after the
change. All other tables stay as defined in Session 1.

# Environment variables

No new variables. Re-use the eight from Session 1 unchanged.

# File layout

New files:

```
src/
  lib/
    crypto.ts                              # Web Crypto AES-256-GCM helper
    db/
      credentials.ts                       # provider_credentials CRUD
      users.ts                             # users upsert
      audit.ts                             # audit_log insert
  app/
    error.tsx                              # global error boundary
    loading.tsx                            # global loading skeleton
    not-found.tsx                          # 404
    favicon.ico                            # exported from <Logo>
    (dashboard)/
      providers/
        page.tsx                           # replace Session 1 placeholder
        actions.ts                         # server actions: set/verify/disconnect
        _components/
          credential-card.tsx
          credential-form.tsx
tests/
  crypto.test.ts                           # encrypt/decrypt roundtrip
```

Modified files:

```
src/
  lib/
    env.ts                                 # land the two Bugbot validators
    auth.ts                                # users.upsertOnSignIn() call
    db/
      schema.ts                            # kind enum: 'github_app' -> 'github_pat'
  app/
    api/
      health/
        route.ts                           # add providers map to response
  components/
    theme-provider.tsx                     # default = dark unless prefers light
```

# Encryption helper spec

`src/lib/crypto.ts`:

```ts
export async function encrypt(plaintext: string): Promise<string>
export async function decrypt(ciphertext: string): Promise<string>
```

- AES-256-GCM via `crypto.subtle`. Import key from
  `Uint8Array.from(atob(env.ENCRYPTION_KEY), c => c.charCodeAt(0))`, length
  must be exactly 32 bytes.
- Generate a fresh 12-byte IV per `encrypt` call via `crypto.getRandomValues`.
- Output format: `base64(iv ‖ ciphertext+tag)`. The IV prefix is the first
  12 bytes after base64-decoding.
- `decrypt` throws on any auth-tag mismatch. Do not catch and return
  empty/null — let it bubble.
- Module-level lazy key cache: parse `env.ENCRYPTION_KEY` once via
  `crypto.subtle.importKey` and reuse the `CryptoKey` for every call.
- No fallbacks, no migration shims.

# Credentials CRUD spec

`src/lib/db/credentials.ts` exports:

```ts
type Kind = 'github_pat' | 'vercel' | 'neon';
type ConnectionState = 'absent' | 'pending' | 'verified' | 'failed';

interface CredentialView {
  kind: Kind;
  lastFour: string;
  connectionState: Exclude<ConnectionState, 'absent'>;
  lastVerifiedAt: Date | null;
}

export async function setCredential(kind: Kind, plaintext: string): Promise<void>
export async function getCredentialPlaintext(kind: Kind): Promise<string | null>
export async function listCredentials(): Promise<CredentialView[]>
export async function markVerified(kind: Kind, ok: boolean): Promise<void>
export async function deleteCredential(kind: Kind): Promise<void>
```

- `setCredential` upserts by `kind`. Encrypts, stores `last_four` =
  `plaintext.slice(-4)`, sets `connection_state='pending'`,
  `last_verified_at=null`. Writes `audit_log` row
  `{action:'credential.set', target: kind}`.
- `getCredentialPlaintext` is server-only (verified by
  `import 'server-only'`). Decrypts and returns plaintext. Never call from
  client code or RSCs that pass props down.
- `listCredentials` is the only way the UI sees credentials. Returns one
  entry per existing row. Never includes plaintext or ciphertext.
- `markVerified(kind, ok)` flips state to `verified` or `failed`, stamps
  `last_verified_at` either way. Writes `audit_log`
  `{action: ok ? 'credential.verified' : 'credential.failed', target: kind}`.
- `deleteCredential` hard-deletes. Writes `audit_log`
  `{action:'credential.deleted', target: kind}`.

# Verify-stub spec

For Session 2 only, `verifyCredential(kind)` (lives in `actions.ts`) does:

1. Call `getCredentialPlaintext(kind)`. If null, throw.
2. Verify the decrypt succeeded (i.e. the call returned a non-empty string).
3. Call `markVerified(kind, true)`.

This proves the encrypt/decrypt path is wired correctly without calling any
provider API. Session 3 will replace step 2 with a real provider probe (a
minimal `GET /user` for GitHub, etc).

# users upsert

`src/lib/db/users.ts`:

```ts
export async function upsertOperator(args: {
  email: string;
  name?: string | null;
  image?: string | null;
}): Promise<void>
```

Called once from the NextAuth `signIn` callback in `src/lib/auth.ts`,
**after** the allowlist check returns `true`. Insert if no row matches the
email; otherwise update `name` and `image` from the latest profile.

# /api/health extension

The route now returns:

```jsonc
{
  "ok": true,
  "db": "up",
  "providers": {
    "github": "absent" | "pending" | "verified" | "failed",
    "vercel": "absent" | "pending" | "verified" | "failed",
    "neon":   "absent" | "pending" | "verified" | "failed"
  },
  "commit": "<sha>"
}
```

Provider state is read from `provider_credentials.connection_state`. Missing
row = `"absent"`. Status code logic is unchanged: 200 iff DB ping succeeds;
provider states do not affect the HTTP code.

# /providers page spec

- Replace the Session 1 `PlaceholderCard` with three `CredentialCard`s in a
  single column, max-width readable, in this order: GitHub PAT, Vercel Token,
  Neon API Key.
- Each card shows: provider name, helper sentence linking to where to
  generate the token, status pill, masked tail (`••••<last4>` if present),
  paste textarea, and a row of buttons:
  - **Save** when the textarea has new content (server action calls
    `setCredential`, then `revalidatePath('/providers')`)
  - **Verify** when state is `pending` or `failed`
  - **Disconnect** when any row exists for that kind (calls
    `deleteCredential`, asks `confirm()` first)
- The `<form>` uses a server action; no client-side fetch. Use
  `useFormStatus`/`useFormState` if you want pending UI on the button — that
  is the only client-side state needed.
- The Connection Center sidebar item already points here from Session 1.
- The Overview page's `Providers · live` KPI must now show the count of
  `verified` credentials (e.g. `2`) instead of `—` once any are verified.

# Carryover from Session 1 (land these while you're in env.ts)

1. `NEXTAUTH_SECRET` validates as 32-byte base64 (same `base64ThirtyTwoBytes`
   refinement as `ENCRYPTION_KEY`). The current `min(16)` placeholder slips
   through.
2. `DATABASE_URL` validates the scheme: must start with `postgres://` or
   `postgresql://`, not just any URL.
3. Update `.env.example`'s `NEXTAUTH_SECRET` comment to say "validated as
   base64 of exactly 32 bytes — placeholder will be rejected."

(My branch `backup/local-d9790c3-bugbot-fixes` already has the diffs if you
want to cherry-pick.)

# Polish

4. **`src/components/theme-provider.tsx`**: change the prefers-color-scheme
   read from `prefersDark ? "dark" : "light"` to
   `prefersLight ? "light" : "dark"`. Spec wants dark to be the default unless
   the user actively prefers light.
5. **`src/app/error.tsx`**: render a card-shaped error UI with title + reset
   button. Reuse the `Card` primitive from Session 1.
6. **`src/app/loading.tsx`**: render a top progress bar or shimmer block
   inside `<main>`. Keep simple.
7. **`src/app/not-found.tsx`**: same `Card`, "page not found" copy, link
   home.
8. **`src/app/favicon.ico`**: re-export the Logo SVG as a 32x32 favicon. The
   spec from Session 1 already requires the monogram; this just makes the
   browser show it.

# Validation

The encrypt/decrypt path is the highest-leverage place for tests in this
session. `tests/crypto.test.ts`:

- `encrypt(x)` is non-deterministic (calling twice yields different
  ciphertext).
- `decrypt(encrypt(x)) === x` for ASCII, Unicode, and 4 KB random strings.
- `decrypt(<mutated_byte_in_ciphertext>)` throws.
- `decrypt(<truncated_to_iv_only>)` throws.

Wire up `vitest` (or `node --test`) — pick whichever is the lighter add. Add
a `pnpm test` script.

# Acceptance criteria for Session 2 (verify all before stopping)

1. `pnpm install && pnpm typecheck && pnpm build && pnpm test` all succeed
   with zero errors.
2. `pnpm db:push` reapplies the schema cleanly (only the `kind` CHECK
   constraint changes).
3. After signing in with the allowlisted email for the first time, the
   `users` table has exactly one row whose email matches `ALLOWED_EMAIL`.
   Sign in a second time: still one row, with `name`/`image` updated.
4. `/providers` initially shows three cards, all `absent`.
5. Pasting any non-empty string + Save flips that card to `pending`, masks
   to `••••<last4>`, and adds an `audit_log` row.
6. Clicking Verify flips the card to `verified`, stamps
   `last_verified_at`, and adds an audit row.
7. `/api/health` returns `{ ok:true, db:"up", providers:{ github:"verified",
   ... }, commit }` with HTTP 200 once at least one provider is verified.
8. Clicking Disconnect deletes the row, the card returns to `absent`, audit
   row added.
9. SQL check: `select ciphertext from provider_credentials limit 1` does
   NOT contain the plaintext. The plaintext can only be recovered via
   `getCredentialPlaintext`.
10. `crypto.test.ts` covers the four cases above and passes.
11. Visiting `/this-does-not-exist` shows the new not-found page.
12. Adding `throw new Error('test')` to any dashboard page temporarily
    shows the new `error.tsx` UI (revert before commit).
13. A user whose OS prefers light mode and has no localStorage entry sees
    light mode on first paint, with no flash to dark.
14. The Overview KPI `Providers · live` shows the correct count (0/1/2/3).
15. The `Connection Center` sidebar item is now active and links to the
    new working `/providers` page.
16. No new console errors or warnings on initial load.

# Out of scope (do not implement)

- Octokit, Vercel SDK, Neon API calls (Session 3+)
- GitHub App webhook flow (Session 5)
- Blueprint catalog, blueprint editor, runs UI, run detail
- Webhook routes
- Per-provider live mode toggles
- Multi-user, RBAC, teams
- Email/Slack notifications
- Image uploads or remote `next/image` configuration

# When you finish

Print a summary that includes:

1. The exact list of new/changed env vars I need to set in Vercel (none new
   this session, but confirm).
2. Any decisions you made that deviate from this prompt and why.
3. Any data my live Neon DB now contains (e.g. one row in `users`).
4. A short "Session 3 readiness check" — what should be true before I run
   Session 3's prompt (e.g. all three providers `verified` in dry-run mode,
   one operator user row, no audit_log gaps).
5. Anything you tried to put in scope and pulled back from, with reasoning.
