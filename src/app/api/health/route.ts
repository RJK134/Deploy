import { NextResponse } from "next/server";

import { pingDatabase } from "@/lib/db/client";
import { listCredentials } from "@/lib/db/credentials";
import { countProjects } from "@/lib/db/projects";
import { countRunsSince } from "@/lib/db/runs";
import type { ProviderKind } from "@/lib/db/schema";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
    // Leave the map all-absent rather than failing the whole probe.
  }
  return initial;
}

async function projectCount(): Promise<number> {
  try {
    return await countProjects();
  } catch {
    return 0;
  }
}

export async function GET() {
  const dbUp = await pingDatabase();
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";

  if (dbUp) {
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);
    const [providers, projects, runs7d] = await Promise.all([
      providerHealth(),
      projectCount(),
      countRunsSince(sevenDaysAgo).catch(() => 0),
    ]);
    return NextResponse.json(
      {
        ok: true,
        db: "up",
        providers,
        projects,
        runs7d,
        commit,
      },
      { status: 200 },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      db: "down",
      providers: { github: "absent", vercel: "absent", neon: "absent" },
      projects: 0,
      runs7d: 0,
      commit,
    },
    { status: 503 },
  );
}
