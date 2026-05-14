import "server-only";

import { desc, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { webhookEvents } from "@/lib/db/schema";

export interface WebhookRow {
  id: string;
  source: string;
  eventType: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
  receivedAt: Date;
  processedAt: Date | null;
}

export async function recordWebhookEvent(args: {
  source: string;
  eventType: string;
  signatureValid: boolean;
  payload: unknown;
}): Promise<string> {
  const [row] = await db
    .insert(webhookEvents)
    .values({
      source: args.source,
      eventType: args.eventType,
      signatureValid: args.signatureValid,
      payloadJson:
        args.payload && typeof args.payload === "object"
          ? (args.payload as Record<string, unknown>)
          : { raw: String(args.payload).slice(0, 4096) },
    })
    .returning({ id: webhookEvents.id });
  return row.id;
}

export async function listWebhookEvents(limit = 50): Promise<WebhookRow[]> {
  const rows = await db
    .select()
    .from(webhookEvents)
    .orderBy(desc(webhookEvents.receivedAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    eventType: r.eventType,
    signatureValid: r.signatureValid,
    payload:
      typeof r.payloadJson === "object" && r.payloadJson !== null
        ? (r.payloadJson as Record<string, unknown>)
        : {},
    receivedAt: r.receivedAt,
    processedAt: r.processedAt,
  }));
}

export async function countWebhookEvents(): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(webhookEvents);
  return rows[0]?.count ?? 0;
}
