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
