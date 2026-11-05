import { Router } from "express";
import { healthRoutes } from "./health.routes";
import { userRoutes } from "./user.routes";

export const apiRouter = Router();

apiRouter.use("/health", healthRoutes);
apiRouter.use("/users", userRoutes);