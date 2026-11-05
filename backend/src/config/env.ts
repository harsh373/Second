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
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  console.error(`Invalid environment configuration:\n${problems.join("\n")}`);
  process.exit(1);
}

export const env = parsed.data;