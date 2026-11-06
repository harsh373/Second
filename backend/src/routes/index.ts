import { Router } from "express";
import { healthRoutes } from "./health.routes";
import { userRoutes } from "./user.routes";
import { integrationRoutes } from "./integration.routes";
import { gmailRoutes } from "./gmail.routes";
import { calendarRoutes } from "./calendar.routes";
import { conversationRoutes } from "./conversation.routes";
import { memoryRoutes } from "./memory.routes";
import { commitmentRoutes } from "./commitment.routes";
import { openLoopRoutes } from "./openLoop.routes";
import { peopleRoutes } from "./people.routes";

export const apiRouter = Router();

apiRouter.use("/health", healthRoutes);
apiRouter.use("/users", userRoutes);
apiRouter.use("/integrations", integrationRoutes);
apiRouter.use("/gmail", gmailRoutes);
apiRouter.use("/calendar", calendarRoutes);
apiRouter.use("/conversations", conversationRoutes);
apiRouter.use("/memories", memoryRoutes);
apiRouter.use("/commitments", commitmentRoutes);
apiRouter.use("/open-loops", openLoopRoutes);
apiRouter.use("/people", peopleRoutes);