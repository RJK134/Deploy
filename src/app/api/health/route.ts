import { NextResponse } from "next/server";

import { pingDatabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const ok = await pingDatabase();
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
  if (ok) {
    return NextResponse.json(
      { ok: true, db: "up", commit },
      { status: 200 },
    );
  }
  return NextResponse.json(
    { ok: false, db: "down", commit },
    { status: 503 },
  );
}
