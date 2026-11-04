import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Reuse the backend's .env so the database URL lives in one place.
config({ path: "backend/.env" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Create backend/.env (see backend/.env.example).");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./database/schema/index.ts",
  out: "./database/migrations",
  dbCredentials: { url: process.env.DATABASE_URL },
});