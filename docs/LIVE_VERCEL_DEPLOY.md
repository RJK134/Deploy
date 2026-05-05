# Live Vercel deployments

This document describes the live Vercel deployment path: what is real, what is
required, what blocks, and how to drive it from the UI or curl.

## What is real

DeployOps Console can trigger **real** Vercel deployments for a selected
GitHub repo + branch. The pipeline:

1. **Token resolution.** Vercel access token is resolved server-side in
   priority order: stored connection token (encrypted with AES-256-GCM,
   decrypted at call time) > `VERCEL_TOKEN` environment variable. The token
   never leaves the server. It is never logged.
2. **Project lookup.** Calls `GET /v9/projects` (paged). Finds the first
   project whose `link.org/repo` matches the selected GitHub repo. Both
   personal and team scopes are tried.
3. **Deployment create.** `POST /v13/deployments` with body
   `{ name, gitSource: { type: "github", ref, org, repo }, target? }`.
   Vercel resolves the latest commit on the branch and runs the build using
   the project's existing settings.
4. **Polling.** `GET /v13/deployments/{id}` every 2 → 10s (exponential
   backoff capped at 10s). Persists each `readyState` update verbatim.
5. **Events.** When the deployment reaches a terminal state
   (`READY` / `ERROR` / `CANCELED`), pulls
   `GET /v3/deployments/{id}/events?follow=0` and stores every event line.
   No event lines are synthesized; if Vercel returns no events, the UI
   states that explicitly.

## What is **not** real in this branch

- Neon database provisioning, Prisma migrations, Railway services. These
  remain dry-run plans only. Their stages render `[dry-run]` log lines and
  the run lands in `validated_dry_run`, never `succeeded`.
- Vercel project import (creating a brand new Vercel project from scratch).
  Vercel's project import flow requires a one-time human step on
  `https://vercel.com/new` that installs the Vercel-GitHub app on the
  GitHub org. DeployOps cannot perform that for you. If the project is
  missing, the live deploy lands in `live_blocked` with code
  `vercel-github-integration-required` (or `no-linked-project`) and a
  remediation pointing the user to vercel.com/new.

## Required setup

| Requirement                         | Where                                | Why                                           |
| ----------------------------------- | ------------------------------------ | --------------------------------------------- |
| `DEPLOYOPS_LIVE=1`                  | DeployOps server env                 | Global gate; live ops are dry-run otherwise.  |
| Vercel token (connection or env)    | `/providers` or `VERCEL_TOKEN` env   | Authenticates the REST API call.              |
| `DEPLOYOPS_SECRET_KEY`              | DeployOps server env                 | AES key for storing connection tokens.        |
| Vercel-GitHub integration installed | https://vercel.com/dashboard/integrations | Lets Vercel pull from your GitHub org/user. |
| One Vercel project per repo         | https://vercel.com/new               | First-time import creates the project link.   |
| Real GitHub repo source             | wizard repo picker                   | Project must be sourced from `gh`, not manual.|

The `/readiness` page reflects every gate live; the wizard's review step
shows a per-run preflight summary.

## Confirmation gate

`POST /api/runs/:id/start-live` requires the body to include
`{ confirm: "I UNDERSTAND" }` unless `DEPLOYOPS_CONFIRM_LIVE_DEPLOY=0` is
set on the server. The UI sends this automatically on the run page after a
browser `confirm()` dialog.

## Failure modes

| Code                                 | What happened                                          | Operator action                                                                            |
| ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `deployops-live-disabled`            | `DEPLOYOPS_LIVE` is unset                              | Set `DEPLOYOPS_LIVE=1`                                                                     |
| `non-github-source`                  | Project was created without picking a real GitHub repo | Recreate the project from the wizard's GitHub picker                                       |
| `no-vercel-token`                    | No connection AND no `VERCEL_TOKEN`                    | Connect Vercel in `/providers` or set `VERCEL_TOKEN`                                       |
| `vercel-token-unauthorized`          | Vercel returned 401/403                                | Generate a new token at https://vercel.com/account/tokens                                  |
| `vercel-project-lookup-failed`       | API error during project listing                       | Inspect the upstream message; rerun                                                        |
| `no-linked-project`                  | No Vercel project links to the repo                    | Import the repo on https://vercel.com/new                                                  |
| `vercel-github-integration-required` | Vercel app not installed on org                        | Install via https://vercel.com/dashboard/integrations                                      |
| `project-not-found`                  | Vercel returned `project_not_found`                    | Same — import on https://vercel.com/new                                                    |
| `timeout`                            | Vercel call exceeded the request timeout               | Retry; check Vercel status                                                                 |

`live_failed` (terminal) means the deployment was created but Vercel
reported `ERROR` / `CANCELED`. The error message comes from Vercel
(`error.message`); the events log shows real Vercel events.

## Driving from curl

```bash
# 1. Create a live run (the wizard normally does this).
curl -X POST $HOST/api/runs \
  -H 'Content-Type: application/json' \
  -d '{ "projectId": 4, "environment": "test", "mode": "live", "providers": ["github","vercel"], "envVars": [] }'

# 2. Check readiness.
curl "$HOST/api/live/vercel/readiness?projectId=4&branch=main"

# 3. Start the live deployment (real Vercel call).
curl -X POST $HOST/api/runs/<runId>/start-live \
  -H 'Content-Type: application/json' \
  -d '{ "confirm": "I UNDERSTAND" }'

# 4. Poll until terminal.
while :; do
  curl -s "$HOST/api/runs/<runId>/live-status" | jq '{status, vercelStatus, vercelUrl, done}'
  sleep 3
done
```

## Why no automatic project import?

Vercel's project import is a deliberate one-time consent step: it installs
the Vercel-GitHub OAuth app on the GitHub org/user, which grants Vercel
read access to the org's repos. DeployOps cannot fake or proxy that — the
GitHub org owner must consent in the browser. We surface this as a clear
blocker rather than fabricating an "imported" state that doesn't exist.
