import { NextResponse } from "next/server";

import { pingDatabase } from "@/lib/db/client";
import { listCredentials } from "@/lib/db/credentials";
import type { ProviderKind } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProviderHealth = "absent" | "pending" | "verified" | "failed";

const KIND_TO_HEALTH_LABEL: Record<ProviderKind, "github" | "vercel" | "neon"> =
  {
    github_pat: "github",
    vercel: "vercel",
    neon: "neon",
  };

async function providerHealth(): Promise<Record<string, ProviderHealth>> {
  const initial: Record<string, ProviderHealth> = {
    github: "absent",
    vercel: "absent",
    neon: "absent",
  };
  try {
    const rows = await listCredentials();
    for (const row of rows) {
      const label = KIND_TO_HEALTH_LABEL[row.kind];
      if (label) initial[label] = row.connectionState;
    }
  } catch {
    // If the providers table read fails, leave the map as all-absent rather
    // than failing the whole health check. The DB ping below is what gates
    // the HTTP status.
  }
  return initial;
}

export async function GET() {
  const dbUp = await pingDatabase();
  const providers = dbUp ? await providerHealth() : null;
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

  if (dbUp) {
    return NextResponse.json(
      { ok: true, db: "up", providers, commit },
      { status: 200 },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      db: "down",
      providers: { github: "absent", vercel: "absent", neon: "absent" },
      commit,
    },
    { status: 503 },
  );
}

