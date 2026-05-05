/**
 * Postgres schema for DeployOps Console.
 *
 * Mirrors `schema.ts` (SQLite) using `pg-core` types so `drizzle-kit push`
 * can apply the schema to a Neon / Vercel Postgres database. The application
 * imports `schema.ts` (SQLite) by default; the runtime adapter in
 * `server/db.ts` uses generic Drizzle ops that work on both dialects.
 *
 * Run:   DEPLOYOPS_DIALECT=postgres DATABASE_URL=postgres://... npm run db:push:pg
 */
import { pgTable, serial, text, integer, boolean, bigint } from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  repo: text("repo").notNull(),
  framework: text("framework").notNull(),
  buildCommand: text("build_command").notNull(),
  outputDir: text("output_dir").notNull(),
  rootDir: text("root_dir").notNull().default("."),
  needsDatabase: boolean("needs_database").notNull().default(false),
  ormDetected: text("orm_detected"),
  envExample: text("env_example_json").notNull().default("[]"),
  blueprintId: integer("blueprint_id"),
  accessMode: text("access_mode").notNull().default("private"),
  sourceProvider: text("source_provider").notNull().default("manual"),
  sourceBranch: text("source_branch"),
  sourceUrl: text("source_url"),
  sourceDefaultBranch: text("source_default_branch"),
  sourceVisibility: text("source_visibility"),
  sourceLanguage: text("source_language"),
  sourceUpdatedAt: bigint("source_updated_at", { mode: "number" }),
  detectedConfig: text("detected_config_json").notNull().default("{}"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  environment: text("environment").notNull(),
  mode: text("mode").notNull().default("dry-run"),
  status: text("status").notNull().default("queued"),
  providers: text("providers_json").notNull().default("[]"),
  envVars: text("env_vars_json").notNull().default("[]"),
  notes: text("notes"),
  vercelDeploymentId: text("vercel_deployment_id"),
  vercelProjectId: text("vercel_project_id"),
  vercelProjectName: text("vercel_project_name"),
  vercelTeamId: text("vercel_team_id"),
  vercelStatus: text("vercel_status"),
  vercelUrl: text("vercel_url"),
  vercelAliasUrl: text("vercel_alias_url"),
  vercelInspectorUrl: text("vercel_inspector_url"),
  vercelErrorMessage: text("vercel_error_message"),
  vercelEvents: text("vercel_events_json").notNull().default("[]"),
  vercelLastPolledAt: bigint("vercel_last_polled_at", { mode: "number" }),
  startedAt: bigint("started_at", { mode: "number" }),
  finishedAt: bigint("finished_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const stages = pgTable("stages", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  order: integer("order_idx").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  description: text("description").notNull(),
  provider: text("provider"),
  status: text("status").notNull().default("pending"),
  startedAt: bigint("started_at", { mode: "number" }),
  finishedAt: bigint("finished_at", { mode: "number" }),
  log: text("log").notNull().default(""),
});

export const blueprints = pgTable("blueprints", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull(),
  description: text("description").notNull(),
  framework: text("framework").notNull(),
  providers: text("providers_json").notNull().default("[]"),
  defaults: text("defaults_json").notNull().default("{}"),
  recommended: boolean("recommended").notNull().default(false),
});

export const providers = pgTable("providers", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  status: text("status").notNull().default("disconnected"),
  mode: text("mode").notNull().default("dry-run"),
  notes: text("notes").notNull().default(""),
  capabilities: text("capabilities_json").notNull().default("[]"),
  lastChecked: bigint("last_checked", { mode: "number" }),
});

export const providerConnections = pgTable("provider_connections", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().unique(),
  status: text("status").notNull().default("disconnected"),
  authMethod: text("auth_method").notNull().default("none"),
  tokenCipher: text("token_cipher"),
  tokenLast4: text("token_last4"),
  refreshCipher: text("refresh_cipher"),
  accountJson: text("account_json").notNull().default("{}"),
  scopesJson: text("scopes_json").notNull().default("[]"),
  errorsJson: text("errors_json").notNull().default("[]"),
  liveMode: boolean("live_mode").notNull().default(false),
  expiresAt: bigint("expires_at", { mode: "number" }),
  lastValidatedAt: bigint("last_validated_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const connectionEvents = pgTable("connection_events", {
  id: serial("id").primaryKey(),
  connectionId: integer("connection_id"),
  provider: text("provider").notNull(),
  event: text("event").notNull(),
  ok: boolean("ok").notNull().default(true),
  detail: text("detail").notNull().default(""),
  meta: text("meta_json").notNull().default("{}"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const healthChecks = pgTable("health_checks", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  target: text("target").notNull(),
  status: text("status").notNull().default("ok"),
  intervalSec: integer("interval_sec").notNull().default(60),
  lastObservedAt: bigint("last_observed_at", { mode: "number" }),
  lastDetail: text("last_detail").notNull().default(""),
});

export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id"),
  runId: integer("run_id"),
  title: text("title").notNull(),
  category: text("category").notNull(),
  severity: text("severity").notNull().default("warning"),
  status: text("status").notNull().default("open"),
  autonomy: text("autonomy").notNull().default("approval-required"),
  source: text("source").notNull().default("fixbot"),
  summary: text("summary").notNull().default(""),
  signals: text("signals_json").notNull().default("[]"),
  detectedAt: bigint("detected_at", { mode: "number" }).notNull(),
  resolvedAt: bigint("resolved_at", { mode: "number" }),
});

export const diagnoses = pgTable("diagnoses", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull(),
  rootCause: text("root_cause").notNull(),
  evidence: text("evidence_json").notNull().default("[]"),
  confidence: integer("confidence").notNull().default(0),
  recommendation: text("recommendation").notNull().default(""),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const remediations = pgTable("remediations", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull(),
  action: text("action").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("proposed"),
  approvalRequired: boolean("approval_required").notNull().default(true),
  payload: text("payload_json").notNull().default("{}"),
  log: text("log").notNull().default(""),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  completedAt: bigint("completed_at", { mode: "number" }),
});

export const githubRepos = pgTable("github_repos", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull().unique(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  url: text("url"),
  cloneUrl: text("clone_url"),
  defaultBranch: text("default_branch").notNull().default("main"),
  isPrivate: boolean("is_private").notNull().default(false),
  fork: boolean("fork").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  language: text("language"),
  pushedAt: text("pushed_at"),
  updatedAt: text("updated_at"),
  topics: text("topics_json").notNull().default("[]"),
  cachedAt: bigint("cached_at", { mode: "number" }).notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  scope: text("scope").notNull(),
  refId: integer("ref_id"),
  actor: text("actor").notNull().default("fixbot"),
  event: text("event").notNull(),
  detail: text("detail").notNull().default(""),
  mode: text("mode").notNull().default("dry-run"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});
