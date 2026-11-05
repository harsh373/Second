import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load backend/.env no matter which folder the server is started from.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../.env") });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  CLERK_PUBLISHABLE_KEY: z.string().startsWith("pk_", "Must be your Clerk publishable key (pk_...)"),
  CLERK_SECRET_KEY: z.string().startsWith("sk_", "Must be your Clerk secret key (sk_...)"),
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  GOOGLE_REDIRECT_URI: z.string().url().default("http://localhost:5173/app/settings"),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "Must be exactly 64 hex characters. Generate with: openssl rand -hex 32"),
  GROQ_API_KEY: z.string().min(1, "GROQ_API_KEY is required (create one at console.groq.com)"),
  GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-120b"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  console.error(`Invalid environment configuration:\n${problems.join("\n")}`);
  process.exit(1);
}

export const env = parsed.data;