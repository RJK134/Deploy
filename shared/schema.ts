import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * DeployOps Console — schema
 *
 * `projects`     a GitHub repo wired up for managed deployment
 * `runs`         one orchestrated deployment attempt for a project
 * `stages`       individual pipeline steps within a run (ordered)
 * `blueprints`   reusable environment templates (stack + provider matrix)
 * `providers`    GitHub / Vercel / Neon / Prisma / Railway connection state
 *
 * SQLite has no array type — JSON is stored as text and parsed in app code.
 */

/* -------------------------------- projects -------------------------------- */
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  repo: text("repo").notNull(),                    // org/repo
  framework: text("framework").notNull(),          // nextjs|node|static|astro|...
  buildCommand: text("build_command").notNull(),
  outputDir: text("output_dir").notNull(),
  rootDir: text("root_dir").notNull().default("."),
  needsDatabase: integer("needs_database", { mode: "boolean" }).notNull().default(false),
  ormDetected: text("orm_detected"),               // prisma|drizzle|null
  envExample: text("env_example_json").notNull().default("[]"), // JSON: string[]
  blueprintId: integer("blueprint_id"),
  accessMode: text("access_mode").notNull().default("private"), // public|client|private
  createdAt: integer("created_at").notNull(),
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
});
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projects.$inferSelect;

/* ---------------------------------- runs ---------------------------------- */
export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").notNull(),
  environment: text("environment").notNull(),      // test|demo|deploy
  mode: text("mode").notNull().default("dry-run"), // dry-run|live
  status: text("status").notNull().default("queued"), // queued|running|succeeded|failed|paused
  providers: text("providers_json").notNull().default("[]"), // JSON string[]
  envVars: text("env_vars_json").notNull().default("[]"),    // JSON {key,value,source}[]
  notes: text("notes"),
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
  createdAt: integer("created_at").notNull(),
});
export const insertRunSchema = createInsertSchema(runs).omit({
  id: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
});
export type InsertRun = z.infer<typeof insertRunSchema>;
export type Run = typeof runs.$inferSelect;

/* --------------------------------- stages --------------------------------- */
export const stages = sqliteTable("stages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull(),
  order: integer("order_idx").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  description: text("description").notNull(),
  provider: text("provider"),                      // github|vercel|neon|prisma|railway|null
  status: text("status").notNull().default("pending"), // pending|running|succeeded|failed|skipped
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
  log: text("log").notNull().default(""),
});
export const insertStageSchema = createInsertSchema(stages).omit({
  id: true,
  startedAt: true,
  finishedAt: true,
});
export type InsertStage = z.infer<typeof insertStageSchema>;
export type Stage = typeof stages.$inferSelect;

/* ------------------------------- blueprints ------------------------------- */
export const blueprints = sqliteTable("blueprints", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull(),
  description: text("description").notNull(),
  framework: text("framework").notNull(),
  providers: text("providers_json").notNull().default("[]"), // JSON string[]
  defaults: text("defaults_json").notNull().default("{}"),   // JSON object
  recommended: integer("recommended", { mode: "boolean" }).notNull().default(false),
});
export const insertBlueprintSchema = createInsertSchema(blueprints).omit({ id: true });
export type InsertBlueprint = z.infer<typeof insertBlueprintSchema>;
export type Blueprint = typeof blueprints.$inferSelect;

/* -------------------------------- providers ------------------------------- */
export const providers = sqliteTable("providers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),             // github|vercel|neon|prisma|railway
  name: text("name").notNull(),
  status: text("status").notNull().default("disconnected"), // connected|disconnected|partial
  mode: text("mode").notNull().default("dry-run"),          // dry-run|live
  notes: text("notes").notNull().default(""),
  capabilities: text("capabilities_json").notNull().default("[]"), // JSON string[]
  lastChecked: integer("last_checked"),
});
export const insertProviderSchema = createInsertSchema(providers).omit({ id: true, lastChecked: true });
export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type Provider = typeof providers.$inferSelect;

/* -------------------- Fix Bot: incidents / checks / etc -------------------- */
/**
 * Fix Bot reliability domain.
 *
 * `healthChecks`     a recurring probe (HTTP, build, migration, env) that emits a status
 * `incidents`        a detected problem with one or more diagnoses + remediations
 * `diagnoses`        an analyzed root cause card with confidence + evidence
 * `remediations`     a proposed or executed fix step (PR, redeploy, env update, escalate)
 * `auditLogs`        every Fix Bot action recorded immutably (dry-run by default)
 */
export const healthChecks = sqliteTable("health_checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),                    // http|build|migration|env|domain|workflow
  target: text("target").notNull(),                // URL, build name, migration tag, etc.
  status: text("status").notNull().default("ok"),  // ok|warning|down|unknown
  intervalSec: integer("interval_sec").notNull().default(60),
  lastObservedAt: integer("last_observed_at"),
  lastDetail: text("last_detail").notNull().default(""),
});
export const insertHealthCheckSchema = createInsertSchema(healthChecks).omit({ id: true, lastObservedAt: true });
export type InsertHealthCheck = z.infer<typeof insertHealthCheckSchema>;
export type HealthCheck = typeof healthChecks.$inferSelect;

export const incidents = sqliteTable("incidents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id"),
  runId: integer("run_id"),
  title: text("title").notNull(),
  category: text("category").notNull(),            // env|build|migration|domain|ci|runtime
  severity: text("severity").notNull().default("warning"), // info|warning|critical
  status: text("status").notNull().default("open"),        // open|diagnosing|fix-ready|approved|resolved|escalated
  autonomy: text("autonomy").notNull().default("approval-required"), // diagnose-only|prepare-fix|approval-required|safe-auto-fix
  source: text("source").notNull().default("fixbot"),      // fixbot|manual|webhook
  summary: text("summary").notNull().default(""),
  signals: text("signals_json").notNull().default("[]"),   // JSON: log lines / probe results
  detectedAt: integer("detected_at").notNull(),
  resolvedAt: integer("resolved_at"),
});
export const insertIncidentSchema = createInsertSchema(incidents).omit({ id: true, detectedAt: true, resolvedAt: true });
export type InsertIncident = z.infer<typeof insertIncidentSchema>;
export type Incident = typeof incidents.$inferSelect;

export const diagnoses = sqliteTable("diagnoses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  incidentId: integer("incident_id").notNull(),
  rootCause: text("root_cause").notNull(),
  evidence: text("evidence_json").notNull().default("[]"), // JSON string[]
  confidence: integer("confidence").notNull().default(0),  // 0-100
  recommendation: text("recommendation").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});
export const insertDiagnosisSchema = createInsertSchema(diagnoses).omit({ id: true, createdAt: true });
export type InsertDiagnosis = z.infer<typeof insertDiagnosisSchema>;
export type Diagnosis = typeof diagnoses.$inferSelect;

export const remediations = sqliteTable("remediations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  incidentId: integer("incident_id").notNull(),
  action: text("action").notNull(),                // open-pr|retry-deploy|update-env|run-migration|escalate|rollback|create-issue
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("proposed"), // proposed|approved|running|applied|failed|dismissed
  approvalRequired: integer("approval_required", { mode: "boolean" }).notNull().default(true),
  payload: text("payload_json").notNull().default("{}"), // JSON object: PR body, env diff, etc.
  log: text("log").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  completedAt: integer("completed_at"),
});
export const insertRemediationSchema = createInsertSchema(remediations).omit({ id: true, createdAt: true, completedAt: true });
export type InsertRemediation = z.infer<typeof insertRemediationSchema>;
export type Remediation = typeof remediations.$inferSelect;

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull(),                  // fixbot|run|provider|migration
  refId: integer("ref_id"),
  actor: text("actor").notNull().default("fixbot"),// fixbot|user|system
  event: text("event").notNull(),                  // diagnose|propose|approve|apply|dismiss|escalate
  detail: text("detail").notNull().default(""),
  mode: text("mode").notNull().default("dry-run"), // dry-run|live
  createdAt: integer("created_at").notNull(),
});
export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
