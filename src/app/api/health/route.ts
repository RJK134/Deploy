import { NextResponse } from "next/server";

import { pingDatabase } from "@/lib/db/client";
import { listCredentials } from "@/lib/db/credentials";
import { countProjects } from "@/lib/db/projects";
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
    const [providers, projects] = await Promise.all([
      providerHealth(),
      projectCount(),
    ]);
    return NextResponse.json(
      { ok: true, db: "up", providers, projects, commit },
      { status: 200 },
    );
  }
  return NextResponse.json(
    {
      ok: false,
      db: "down",
      providers: { github: "absent", vercel: "absent", neon: "absent" },
      projects: 0,
      commit,
    },
    { status: 503 },
  );
}
