import { Router } from "express";
import { healthRoutes } from "./health.routes";

export const apiRouter = Router();

apiRouter.use("/health", healthRoutes);