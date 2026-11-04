import { createDb } from "../../../database/client";
import { env } from "../config/env";

export const { db, pool, ping } = createDb(env.DATABASE_URL);