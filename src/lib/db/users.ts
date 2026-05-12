import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export async function upsertOperator(args: {
  email: string;
  name?: string | null;
  image?: string | null;
}): Promise<void> {
  const email = args.email.toLowerCase().trim();
  await db
    .insert(users)
    .values({
      email,
      name: args.name ?? null,
      image: args.image ?? null,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: sql`excluded.name`,
        image: sql`excluded.image`,
      },
    });
}
