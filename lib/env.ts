import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),

  ANTHROPIC_API_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1).optional(),

  GOOGLE_TTS_API_KEY: z.string().min(1).optional(),

  COS_INGEST_TOKEN: z.string().min(16),
  CRON_SECRET: z.string().min(1).optional(),

  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),

  INNGEST_EVENT_KEY: z.string().min(1).optional(),
  INNGEST_SIGNING_KEY: z.string().min(1).optional(),

  SENTRY_DSN: z.string().url().optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_NAME: z.string().default("Chief of Staff"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.flatten().fieldErrors;
    const missing = Object.entries(formatted)
      .map(([k, v]) => `  ${k}: ${(v ?? []).join(", ")}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${missing}`);
  }
  cached = parsed.data;
  return cached;
}

export function isProd(): boolean {
  return env().NODE_ENV === "production";
}
