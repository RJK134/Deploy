import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/db/audit";
import { recordWebhookEvent } from "@/lib/db/webhooks";
import { env } from "@/lib/env";
import { verifyHmacSha256 } from "@/lib/webhooks/hmac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "GITHUB_WEBHOOK_SECRET not configured" },
      { status: 503 },
    );
  }

  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const eventType = req.headers.get("x-github-event") ?? "unknown";
  const deliveryId = req.headers.get("x-github-delivery") ?? null;

  const valid = await verifyHmacSha256({
    body,
    signatureHeader: signature,
    secret,
  });

  if (!valid) {
    // Persist the failed attempt for forensics, then 401.
    try {
      await recordWebhookEvent({
        source: "github",
        eventType,
        signatureValid: false,
        payload: { reason: "bad-signature", deliveryId },
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
    source: "github",
    eventType,
    signatureValid: true,
    payload,
  });

  await recordAudit({
    actor: "github-webhook",
    action: "webhook.received",
    target: id,
    metadata: { source: "github", eventType, deliveryId },
  });

  return NextResponse.json({ ok: true, id });
}
