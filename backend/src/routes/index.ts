import { Router } from "express";
import { healthRoutes } from "./health.routes";
import { userRoutes } from "./user.routes";
import { integrationRoutes } from "./integration.routes";

export const apiRouter = Router();

apiRouter.use("/health", healthRoutes);
apiRouter.use("/users", userRoutes);
apiRouter.use("/integrations", integrationRoutes);