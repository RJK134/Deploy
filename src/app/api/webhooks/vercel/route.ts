import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/db/audit";
import { recordWebhookEvent } from "@/lib/db/webhooks";
import { env } from "@/lib/env";
import { verifyHmac } from "@/lib/webhooks/hmac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel sends `x-vercel-signature` containing the hex-encoded HMAC-SHA1 of
 * the raw request body, signed with the team webhook secret. We verify with
 * SHA-1 to match what Vercel actually emits.
 */
export async function POST(req: Request) {
  const secret = env.VERCEL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "VERCEL_WEBHOOK_SECRET not configured" },
      { status: 503 },
    );
  }

  const body = await req.text();
  const signature = req.headers.get("x-vercel-signature");
  const eventType = req.headers.get("x-vercel-event") ?? "unknown";

  const valid = await verifyHmac({
    algorithm: "sha-1",
    body,
    signatureHeader: signature,
    secret,
  });

  if (!valid) {
    try {
      await recordWebhookEvent({
        source: "vercel",
        eventType,
        signatureValid: false,
        payload: { reason: "bad-signature" },
      });
    } catch {
      // best effort
    }
    return NextResponse.json(
      { ok: false, error: "invalid signature" },
      { status: 401 },
    );
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = { rawBytes: body.length };
  }

  const id = await recordWebhookEvent({
    source: "vercel",
    eventType,
    signatureValid: true,
    payload,
  });

  await recordAudit({
    actor: "vercel-webhook",
    action: "webhook.received",
    target: id,
    metadata: { source: "vercel", eventType },
  });

  return NextResponse.json({ ok: true, id });
}
