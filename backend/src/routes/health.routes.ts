import { Router } from "express";
import { getLiveness, getReadiness } from "../controllers/health.controller";

export const healthRoutes = Router();

healthRoutes.get("/", getLiveness);
healthRoutes.get("/ready", getReadiness);