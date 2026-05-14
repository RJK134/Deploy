import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const PROVIDER_KINDS = ["github_pat", "vercel", "neon"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const CONNECTION_STATES = [
  "pending",
  "verified",
  "failed",
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const providerCredentials = pgTable("provider_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: PROVIDER_KINDS }).notNull().unique(),
  ciphertext: text("ciphertext").notNull(),
  lastFour: text("last_four").notNull(),
  connectionState: text("connection_state", { enum: CONNECTION_STATES })
    .notNull()
    .default("pending"),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const blueprints = pgTable("blueprints", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  jsonDefinition: jsonb("json_definition").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const ACCESS_MODES = ["public", "client", "private"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  githubOwner: text("github_owner").notNull(),
  githubRepo: text("github_repo").notNull(),
  blueprintId: uuid("blueprint_id"),
  defaultBranch: text("default_branch"),
  framework: text("framework"),
  accessMode: text("access_mode", { enum: ACCESS_MODES })
    .notNull()
    .default("private"),
  customDomain: text("custom_domain"),
  vercelProjectId: text("vercel_project_id"),
  vercelTeamId: text("vercel_team_id"),
  neonProjectId: text("neon_project_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id),
  environment: text("environment", {
    enum: ["test", "demo", "deploy"],
  }).notNull(),
  mode: text("mode", { enum: ["dry_run", "live"] }).notNull(),
  status: text("status").notNull().default("pending"),
  planJson: jsonb("plan_json"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  triggeredBy: text("triggered_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const stages = pgTable("stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  logText: text("log_text").default(""),
  errorJson: jsonb("error_json"),
  outputJson: jsonb("output_json"),
});

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(),
  eventType: text("event_type").notNull(),
  signatureValid: boolean("signature_valid").notNull(),
  payloadJson: jsonb("payload_json").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target"),
  metadataJson: jsonb("metadata_json"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const AUTONOMY_LEVELS = [
  "diagnose-only",
  "prepare-fix",
  "approval-required",
  "safe-auto-fix",
] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const INCIDENT_STATUSES = [
  "open",
  "diagnosed",
  "remediating",
  "resolved",
  "dismissed",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const MONITOR_KINDS = ["http", "build", "migration", "env", "domain", "workflow"] as const;
export type MonitorKind = (typeof MONITOR_KINDS)[number];

export const MONITOR_STATUSES = ["healthy", "warning", "down", "unknown"] as const;
export type MonitorStatus = (typeof MONITOR_STATUSES)[number];

export const fixbotMonitors = pgTable("fixbot_monitors", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  kind: text("kind", { enum: MONITOR_KINDS }).notNull(),
  label: text("label").notNull(),
  config: jsonb("config").notNull(),
  status: text("status", { enum: MONITOR_STATUSES })
    .notNull()
    .default("unknown"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const fixbotIncidents = pgTable("fixbot_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  monitorId: uuid("monitor_id").references(() => fixbotMonitors.id, {
    onDelete: "set null",
  }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "cascade",
  }),
  title: text("title").notNull(),
  summary: text("summary"),
  status: text("status", { enum: INCIDENT_STATUSES })
    .notNull()
    .default("open"),
  autonomy: text("autonomy", { enum: AUTONOMY_LEVELS })
    .notNull()
    .default("approval-required"),
  openedAt: timestamp("opened_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const fixbotDiagnoses = pgTable("fixbot_diagnoses", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => fixbotIncidents.id, { onDelete: "cascade" }),
  rootCause: text("root_cause").notNull(),
  evidence: jsonb("evidence"),
  confidence: text("confidence", {
    enum: ["low", "medium", "high"],
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const fixbotRemediations = pgTable("fixbot_remediations", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => fixbotIncidents.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  description: text("description").notNull(),
  payloadJson: jsonb("payload_json"),
  approvalRequired: boolean("approval_required").notNull().default(true),
  status: text("status", {
    enum: ["draft", "queued", "applied", "failed", "dismissed"],
  })
    .notNull()
    .default("draft"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
