import { z } from "zod";

const base64ThirtyTwoBytes = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        // atob is available in both Node.js 16+ and the Edge runtime,
        // unlike Buffer which is Node-only and unavailable in Next.js middleware.
        return atob(value).length === 32;
      } catch {
        return false;
      }
    },
    { message: "must be base64 encoding of exactly 32 bytes" },
  );

/**
 * Wrap a Zod string schema so that the empty string (which is what
 * `.env.example` writes for unset values) is treated the same as `undefined`.
 * Without this, copying `.env.example` to `.env.local` would fail validation
 * even though the variable is logically optional. The optional() is applied
 * INSIDE so `undefined` is accepted by the inner pipeline.
 */
function emptyAsUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );
}

const postgresUrl = z
  .string()
  .url("must be a valid Postgres connection URL")
  .refine(
    (value) =>
      value.startsWith("postgres://") || value.startsWith("postgresql://"),
    {
      message:
        "must use the postgres:// or postgresql:// scheme (Neon pooled URL)",
    },
  );

const envSchema = z.object({
  DATABASE_URL: postgresUrl,
  NEXTAUTH_SECRET: base64ThirtyTwoBytes,
  NEXTAUTH_URL: z.string().url("must be a valid URL, e.g. http://localhost:3000"),
  GITHUB_OAUTH_CLIENT_ID: z.string().min(1),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1),
  ALLOWED_EMAIL: z
    .string()
    .email("must be the operator's GitHub-verified email address"),
  ENCRYPTION_KEY: base64ThirtyTwoBytes,
  ENCRYPTION_KEY_NEXT: emptyAsUndefined(base64ThirtyTwoBytes),
  DEPLOYOPS_LIVE: z
    .enum(["0", "1"])
    .default("0")
    .describe("global kill switch — only Session 5+ flips this to 1"),
  GITHUB_WEBHOOK_SECRET: emptyAsUndefined(z.string().min(8)),
  VERCEL_WEBHOOK_SECRET: emptyAsUndefined(z.string().min(8)),
  CRON_SECRET: emptyAsUndefined(z.string().min(16)),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `[deployops] Environment validation failed:\n${issues}\n\n` +
        `Copy .env.example to .env.local and fill in the missing values.`,
    );
  }
  return parsed.data;
}

export const env = parseEnv();

export const isLiveMode = env.DEPLOYOPS_LIVE === "1";
