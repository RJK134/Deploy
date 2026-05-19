import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { runBuildMonitorChecks } from "@/lib/fixbot/build-analyzer";
import { runHttpMonitorChecks } from "@/lib/fixbot/http-analyzer";
import { runWorkflowMonitorChecks } from "@/lib/fixbot/workflow-analyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cron endpoint for Vercel Cron (and any other scheduled invoker).
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically when
 * the cron config references this route. We refuse every other caller.
 */
function checkAuth(req: Request): { ok: boolean; reason?: string } {
  const secret = env.CRON_SECRET;
  if (!secret) {
    return { ok: false, reason: "CRON_SECRET not configured" };
  }
  const auth = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return { ok: false, reason: "auth-mismatch" };
  let diff = 0;
  for (let i = 0; i < auth.length; i++) {
    diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return { ok: false, reason: "auth-mismatch" };
  return { ok: true };
}

export async function GET(req: Request) {
  const auth = checkAuth(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.reason },
      { status: env.CRON_SECRET ? 401 : 503 },
    );
  }
  const actor = "cron:monitors";
  const [http, build, workflow] = await Promise.all([
    runHttpMonitorChecks({ actor }).catch((err) => ({
      error: err instanceof Error ? err.message : "unknown",
    })),
    runBuildMonitorChecks({ actor }).catch((err) => ({
      error: err instanceof Error ? err.message : "unknown",
    })),
    runWorkflowMonitorChecks({ actor }).catch((err) => ({
      error: err instanceof Error ? err.message : "unknown",
    })),
  ]);
  return NextResponse.json({
    ok: true,
    reports: { http, build, workflow },
  });
}

export const POST = GET;
