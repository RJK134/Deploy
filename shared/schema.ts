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
