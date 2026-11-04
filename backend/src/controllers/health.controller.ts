import type { RequestHandler } from "express";
import { ping } from "../utility/db";
import { logger } from "../utility/logger";

// Liveness: is the process running? Never touches the database.
export const getLiveness: RequestHandler = (_req, res) => {
  res.json({
    status: "ok",
    service: "second-backend",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
};

// Readiness: can the app really do its job? Checks the database.
export const getReadiness: RequestHandler = async (_req, res) => {
  const timestamp = new Date().toISOString();
  try {
    const ok = await ping();
    if (!ok) throw new Error("Unexpected ping result");
    res.json({ status: "ok", checks: { database: "up" }, timestamp });
  } catch (err) {
    logger.error("Readiness check failed:", err);
    res.status(503).json({ status: "degraded", checks: { database: "down" }, timestamp });
  }
};