/**
 * Database adapter layer.
 *
 * DeployOps Console can run against two backends:
 *
 *   - sqlite (default, local + dry-run): better-sqlite3 + drizzle-orm/better-sqlite3
 *   - postgres (production: Neon / Vercel Postgres): drizzle-orm/postgres-js
 *
 * Selection is driven by DATABASE_URL:
 *   - unset, "sqlite", or starts with "file:" → SQLite, file is `data.db` (or DATABASE_URL minus the file: prefix)
 *   - starts with "postgres://" or "postgresql://" → Postgres adapter (requires `postgres` package; not installed in this repo by default)
 *
 * The Postgres branch is kept thin and clearly marked. Full migration is not
 * automatic — see `docs/DEPLOYMENT.md` and the in-app Migration Plan page.
 *
 * The exported `dbInfo` summarises the active backend so the UI can render it
 * accurately (Production architecture page, Migration Plan page).
 */

import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";

export type DbBackend = "sqlite" | "postgres";

export interface DbInfo {
  backend: DbBackend;
  driver: string;
  url: string;          // sanitized — no password
  source: "default" | "DATABASE_URL";
  liveCapable: boolean; // true once a real Postgres URL is wired
}

function sanitizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.password) u.password = "•••";
    return u.toString();
  } catch {
    return raw;
  }
}

const RAW_URL = (process.env.DATABASE_URL ?? "").trim();
const isPostgres = /^postgres(ql)?:\/\//i.test(RAW_URL);
const sqlitePath = RAW_URL.startsWith("file:")
  ? RAW_URL.replace(/^file:/, "")
  : (RAW_URL && !isPostgres ? RAW_URL : "data.db");

let _db: any;
let _info: DbInfo;

if (isPostgres) {
  /* Postgres / Neon adapter.
   *
   * NOTE: this branch intentionally fails fast with a clear message when the
   * `postgres` package is not installed. To enable production mode:
   *   1. npm install postgres
   *   2. set DATABASE_URL=postgres://...neon.tech/...
   *   3. run `npm run db:push:pg` (provided in package.json)
   *
   * The bundled queries in storage.ts use drizzle-orm and are dialect-portable
   * for the simple selects/inserts used here. Two SQLite-specific bits
   * (boolean integers + JSON-as-text columns) round-trip cleanly because the
   * application code parses JSON itself and treats booleans as 0/1.
   */
  try {
    // Lazy require so SQLite-only installs are not forced to ship pg.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const postgres = require("postgres");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { drizzle: drizzlePg } = require("drizzle-orm/postgres-js");
    const client = postgres(RAW_URL, { ssl: "require", max: 5 });
    _db = drizzlePg(client);
    _info = {
      backend: "postgres",
      driver: "postgres-js + drizzle-orm/postgres-js",
      url: sanitizeUrl(RAW_URL),
      source: "DATABASE_URL",
      liveCapable: true,
    };
    console.log("[db] postgres backend wired:", _info.url);
  } catch (err: any) {
    const msg =
      "[db] DATABASE_URL points at Postgres but the `postgres` package is not installed. " +
      "Run `npm install postgres` and `npm run db:push:pg`, or unset DATABASE_URL to fall back to SQLite. " +
      `Underlying error: ${err?.message ?? err}`;
    console.error(msg);
    throw new Error(msg);
  }
} else {
  const sqlite = new Database(sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  _db = drizzleSqlite(sqlite);
  _info = {
    backend: "sqlite",
    driver: "better-sqlite3 + drizzle-orm/better-sqlite3",
    url: sqlitePath,
    source: RAW_URL ? "DATABASE_URL" : "default",
    liveCapable: false,
  };
  // Ensure SQLite tables exist when running against the local file.
  ensureSqliteTables(sqlite);
}

export const db = _db;
export const dbInfo: DbInfo = _info!;

function ensureSqliteTables(sqlite: Database.Database) {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  repo TEXT NOT NULL,
  framework TEXT NOT NULL,
  build_command TEXT NOT NULL,
  output_dir TEXT NOT NULL,
  root_dir TEXT NOT NULL DEFAULT '.',
  needs_database INTEGER NOT NULL DEFAULT 0,
  orm_detected TEXT,
  env_example_json TEXT NOT NULL DEFAULT '[]',
  blueprint_id INTEGER,
  access_mode TEXT NOT NULL DEFAULT 'private',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  environment TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'dry-run',
  status TEXT NOT NULL DEFAULT 'queued',
  providers_json TEXT NOT NULL DEFAULT '[]',
  env_vars_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  order_idx INTEGER NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at INTEGER,
  finished_at INTEGER,
  log TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS blueprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT NOT NULL,
  description TEXT NOT NULL,
  framework TEXT NOT NULL,
  providers_json TEXT NOT NULL DEFAULT '[]',
  defaults_json TEXT NOT NULL DEFAULT '{}',
  recommended INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  mode TEXT NOT NULL DEFAULT 'dry-run',
  notes TEXT NOT NULL DEFAULT '',
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  last_checked INTEGER
);
CREATE TABLE IF NOT EXISTS health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  interval_sec INTEGER NOT NULL DEFAULT 60,
  last_observed_at INTEGER,
  last_detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  run_id INTEGER,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  status TEXT NOT NULL DEFAULT 'open',
  autonomy TEXT NOT NULL DEFAULT 'approval-required',
  source TEXT NOT NULL DEFAULT 'fixbot',
  summary TEXT NOT NULL DEFAULT '',
  signals_json TEXT NOT NULL DEFAULT '[]',
  detected_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS diagnoses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  root_cause TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  confidence INTEGER NOT NULL DEFAULT 0,
  recommendation TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS remediations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'proposed',
  approval_required INTEGER NOT NULL DEFAULT 1,
  payload_json TEXT NOT NULL DEFAULT '{}',
  log TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  ref_id INTEGER,
  actor TEXT NOT NULL DEFAULT 'fixbot',
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'dry-run',
  created_at INTEGER NOT NULL
);
`);
}
