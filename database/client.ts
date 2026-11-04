import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index";

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });

  // Without this, an idle-connection error would crash the whole server.
  pool.on("error", (err) => console.error("PostgreSQL pool error:", err.message));

  const db = drizzle(pool, { schema });

  async function ping(): Promise<boolean> {
    const result = await pool.query("select 1 as ok");
    return result.rows[0]?.ok === 1;
  }

  return { db, pool, ping };
}