# Provider Connections — DeployOps Console

DeployOps connects to GitHub, Vercel, Neon, Prisma, and Railway through a
**Connection Center**. Tokens are encrypted at rest with AES-256-GCM and
never returned to the client after they're saved. This document covers
setup, scopes, security, and the live-readiness gates.

## Overview

| Provider | Auth method(s)               | What it unlocks                                  |
|----------|------------------------------|--------------------------------------------------|
| GitHub   | OAuth web flow + PAT fallback| Repo discovery, branch listing, framework detect, PR/workflow writes |
| Vercel   | Personal Access Token        | Project listing, env vars, deploys              |
| Neon     | Neon API key                 | List/branch projects                            |
| Prisma   | Management API token         | List projects/regions, manage databases         |
| Railway  | API token                    | Project/service listing, deploys                |

Reads are allowed once a connection is `connected`. Live writes require the
provider's per-connection live mode AND the global `DEPLOYOPS_LIVE=1`.

## Required environment variables

| Variable                           | Purpose                                              |
|------------------------------------|------------------------------------------------------|
| `DEPLOYOPS_SECRET_KEY`             | Master key used to derive AES-256-GCM. Required to save real tokens. Demo mode works without it. |
| `TOKEN_ENCRYPTION_KEY`             | Alias for `DEPLOYOPS_SECRET_KEY`. Either is accepted. |
| `DEPLOYOPS_LIVE`                   | `1` permits live actions globally. Anything else = dry-run.  |
| `DEPLOYOPS_CONFIRM_TOKEN_SAVE`     | `0` to disable the `I UNDERSTAND` confirmation phrase requirement. Default on. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Optional. Enables GitHub OAuth web flow. Without these, only PAT entry is offered. |
| `GITHUB_OAUTH_CALLBACK_URL`        | Optional. Defaults to `${proto}://${host}/api/auth/github/oauth/callback`. |
| `DEPLOYOPS_GITHUB_OWNERS`          | Optional. Comma-separated extra GitHub owners/orgs to aggregate. |

### Generating `DEPLOYOPS_SECRET_KEY`

Generate a long random key once and inject it into your environment. Any
length is accepted (it's hashed with SHA-256 to derive a 32-byte AES key).

```bash
openssl rand -base64 48
# or
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

If the key changes, all stored ciphertexts become unreadable. The UI will
mark connections as `invalid` on next validation; reconnect to repair them.

## Provider setup

### GitHub

1. (Optional, recommended) Register an OAuth App at
   <https://github.com/settings/applications/new>. Set the callback URL to
   `https://YOUR_DOMAIN/api/auth/github/oauth/callback`. Add
   `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` to your environment.
2. Or generate a Personal Access Token at
   <https://github.com/settings/tokens/new?scopes=repo,read:org,workflow>.

**Scopes**

- Required: `repo` (or `public_repo` + `read:org` for read-only org access).
- Recommended: `repo`, `read:org`, `workflow`.

The repo picker prefers stored tokens over `GITHUB_TOKEN` env over the `gh`
CLI. The `live · connection` badge confirms which path is in use.

### Vercel

Create a token at <https://vercel.com/account/tokens>. Recommended scopes:
`read:user`, `read:team`, `read:project`, `write:env`, `write:deployment`.

### Neon

Create an API key at <https://console.neon.tech/app/settings/api-keys>.
Required: `projects:read`. Recommended for branching: `branches:write`.

### Prisma (Prisma Postgres / Management API)

Generate a token in the Prisma Console. Required: `projects:read`.

### Railway

Generate a token at <https://railway.app/account/tokens>. Required:
`projects:read`. Live writes require `deployments:write`.

## Connecting

1. Open **Connection Center** in the sidebar.
2. Click **Connect** on a provider card.
3. Paste the token. Type `I UNDERSTAND` in the confirmation field.
4. Click **Validate & save**. The server validates the token via a
   read-only API call (`/user`, `/v2/user`, `/v2/projects`, etc.) before
   encrypting and storing it.

Demo connections: type `demo` as the token to save a no-secret mock
connection that exercises the UI without any external calls. Useful for
local development without an encryption key.

## Live mode

Live mode is enabled per-provider with a switch on each connection card.
Even when on, live actions still require:

- `DEPLOYOPS_LIVE=1` in the server environment
- The connection is `connected` and recently validated
- No outstanding validation errors
- Per-action approval where applicable (Fix Bot remediations, Wizard runs)

The **Live Readiness** page summarizes what's blocking live deploys. It
shows global blockers (encryption, `DEPLOYOPS_LIVE`) plus per-provider
blockers (missing scopes, validation errors, dry-run flag).

## Security model

- Tokens are encrypted with AES-256-GCM. Each ciphertext has a fresh 12-byte
  random IV and 16-byte auth tag.
- The encryption key never leaves the server process.
- Tokens are never returned to the client after saving — only the last 4
  characters are exposed for UI display.
- Disconnecting wipes the ciphertext from the database. The connection row
  remains so the audit trail (`connection_events`) stays intact.
- Connection events are logged without secret material. They record
  connect / disconnect / validate / live-toggle / error events with provider
  metadata only.
- Validation calls are read-only by design. No adapter mutates external
  state. Live mutations remain gated through the existing dry-run boundary
  in `server/providers.ts` and the Fix Bot apply path.

## Token rotation

To rotate a token:

1. Generate a new token at the provider's console.
2. In Connection Center, click **Reconnect** on the provider card.
3. Paste the new token + confirmation phrase.
4. The server validates and overwrites the ciphertext atomically.

Old tokens become inaccessible immediately. You may also revoke the prior
token at the provider after rotating.

## Live readiness checklist

Use this checklist before flipping live mode on for a real deploy:

- [ ] `DEPLOYOPS_SECRET_KEY` set on the server
- [ ] `DEPLOYOPS_LIVE=1` set on the server (global gate)
- [ ] All required providers connected and validated within the last 24h
- [ ] All required scopes granted (Connection Center shows `missing: …` chips when not)
- [ ] Per-provider live mode enabled
- [ ] No outstanding validation errors
- [ ] Audit log review is signed off

The Live Readiness page reflects each item in real time.

## API surface

| Endpoint                                               | Method | Notes                                          |
|--------------------------------------------------------|--------|------------------------------------------------|
| `/api/connections`                                     | GET    | Lists all five providers; never returns tokens |
| `/api/connections/:provider`                           | GET    | Single connection                              |
| `/api/connections/:provider/connect-token`             | POST   | `{ token, confirm: "I UNDERSTAND" }` body      |
| `/api/connections/:provider/validate`                  | POST   | Re-validates against the provider              |
| `/api/connections/:provider/disconnect`                | POST   | Wipes ciphertext, marks disconnected           |
| `/api/connections/:provider/live`                      | POST   | `{ live: boolean }` toggles per-provider live  |
| `/api/connections/:provider/events`                    | GET    | Connection event log                           |
| `/api/auth/github/oauth/start`                         | GET    | Redirect to GitHub (or `?json=1` for URL)      |
| `/api/auth/github/oauth/callback`                      | GET    | Exchange code → token, encrypt + store         |
| `/api/live/readiness`                                  | GET    | Global + per-provider live readiness summary   |

The GitHub repo picker (`/api/github/repos`, `/branches`, `/detect`) now
prefers the stored connection token, then `GITHUB_TOKEN`, then the `gh`
CLI. The response includes an `authSource` field of `connection`, `env`,
or `cli`.

## Caveats

- This implementation provides the auth/connection infrastructure. Live
  mutations remain dry-run by default in this build. Wiring the existing
  `server/providers.ts` adapters to actually call providers is left as a
  separate operator decision and requires explicit per-action approval.
- OAuth state is held in process memory with a 10-minute TTL. Restarting
  the server invalidates in-flight OAuth flows. Users start over.
- Prisma's Management API surface is in flux; the validator handles 404 as
  a non-fatal warning so token-shape acceptance still passes.
