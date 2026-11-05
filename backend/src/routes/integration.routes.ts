import { Router } from "express";
import {
  completeGoogleConnect,
  disconnectGoogle,
  listIntegrations,
  startGoogleConnect,
  verifyGoogle,
} from "../controllers/integration.controller";
import { requireUser } from "../middleware/auth";

export const integrationRoutes = Router();

integrationRoutes.use(requireUser);

integrationRoutes.get("/", listIntegrations);
integrationRoutes.post("/google/connect", startGoogleConnect);
integrationRoutes.post("/google/callback", completeGoogleConnect);
integrationRoutes.post("/google/verify", verifyGoogle);
integrationRoutes.delete("/google", disconnectGoogle);