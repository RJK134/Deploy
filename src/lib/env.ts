import { z } from "zod";

const base64ThirtyTwoBytes = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        return Buffer.from(value, "base64").length === 32;
      } catch {
        return false;
      }
    },
    { message: "must be base64 encoding of exactly 32 bytes" },
  );

const envSchema = z.object({
  DATABASE_URL: z.string().url("must be a valid Postgres connection URL"),
  NEXTAUTH_SECRET: z
    .string()
    .min(16, "must be at least 16 characters; generate with `openssl rand -base64 32`"),
  NEXTAUTH_URL: z.string().url("must be a valid URL, e.g. http://localhost:3000"),
  GITHUB_OAUTH_CLIENT_ID: z.string().min(1),
  GITHUB_OAUTH_CLIENT_SECRET: z.string().min(1),
  ALLOWED_EMAIL: z
    .string()
    .email("must be the operator's GitHub-verified email address"),
  ENCRYPTION_KEY: base64ThirtyTwoBytes,
  DEPLOYOPS_LIVE: z
    .enum(["0", "1"])
    .default("0")
    .describe("global kill switch — only Session 5+ flips this to 1"),
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
