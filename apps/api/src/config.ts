import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),
  WEB_URL: z.string().url().default("http://localhost:3000"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional()
});

const parsed = schema.safeParse({
  ...process.env,
  API_PORT: process.env.API_PORT || process.env.PORT || undefined
});
if (!parsed.success) {
  console.error("[config] invalid env:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
