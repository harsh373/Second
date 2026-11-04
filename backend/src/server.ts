import { app } from "./app";
import { env } from "./config/env";
import { ping, pool } from "./utility/db";
import { logger } from "./utility/logger";

async function main() {
  try {
    await ping();
    logger.info("PostgreSQL connection verified");
  } catch (err) {
    logger.error("Cannot reach PostgreSQL. Check DATABASE_URL in .env:", err);
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    logger.info(`Second backend listening on port ${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main();