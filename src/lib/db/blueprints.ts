import "server-only";

import { eq, sql } from "drizzle-orm";

import { BUILTIN_BLUEPRINTS } from "@/lib/blueprints/builtin";
import {
  isBlueprintDefinition,
  type BlueprintDefinition,
} from "@/lib/blueprints/types";
import { db } from "@/lib/db/client";
import { blueprints } from "@/lib/db/schema";

export interface BlueprintRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  definition: BlueprintDefinition;
  createdAt: Date;
}

let seededOnce = false;

/**
 * Idempotently upsert the built-in blueprints by slug. Safe to call from
 * any server component; only the first call per process actually issues
 * an INSERT.
 */
export async function ensureBuiltinBlueprints(): Promise<void> {
  if (seededOnce) return;
  for (const def of BUILTIN_BLUEPRINTS) {
    await db
      .insert(blueprints)
      .values({
        slug: def.slug,
        name: def.name,
        description: def.description,
        jsonDefinition: def,
      })
      .onConflictDoUpdate({
        target: blueprints.slug,
        set: {
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          jsonDefinition: sql`excluded.json_definition`,
        },
      });
  }
  seededOnce = true;
}

function rowFromDb(row: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  jsonDefinition: unknown;
  createdAt: Date;
}): BlueprintRow | null {
  if (!isBlueprintDefinition(row.jsonDefinition)) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    definition: row.jsonDefinition,
    createdAt: row.createdAt,
  };
}

export async function listBlueprints(): Promise<BlueprintRow[]> {
  await ensureBuiltinBlueprints();
  const rows = await db
    .select()
    .from(blueprints)
    .orderBy(blueprints.slug);
  return rows
    .map(rowFromDb)
    .filter((r): r is BlueprintRow => r !== null);
}

export async function getBlueprintBySlug(
  slug: string,
): Promise<BlueprintRow | null> {
  await ensureBuiltinBlueprints();
  const rows = await db
    .select()
    .from(blueprints)
    .where(eq(blueprints.slug, slug))
    .limit(1);
  if (rows.length === 0) return null;
  return rowFromDb(rows[0]);
}

export async function getBlueprintById(
  id: string,
): Promise<BlueprintRow | null> {
  const rows = await db
    .select()
    .from(blueprints)
    .where(eq(blueprints.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  return rowFromDb(rows[0]);
}
