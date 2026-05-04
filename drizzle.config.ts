import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config.
 *
 * - Default: SQLite, schema in shared/schema.ts, file at ./data.db.
 * - Postgres: set DEPLOYOPS_DIALECT=postgres and DATABASE_URL=postgres://...
 *   then run `npm run db:push:pg`. The Postgres schema lives at
 *   shared/schema.pg.ts.
 */
const dialect = process.env.DEPLOYOPS_DIALECT === "postgres" ? "postgresql" : "sqlite";

export default defineConfig(
  dialect === "postgresql"
    ? {
        out: "./migrations/postgres",
        schema: "./shared/schema.pg.ts",
        dialect: "postgresql",
        dbCredentials: { url: process.env.DATABASE_URL ?? "" },
      }
    : {
        out: "./migrations/sqlite",
        schema: "./shared/schema.ts",
        dialect: "sqlite",
        dbCredentials: { url: "./data.db" },
      },
);
