import { Router } from "express";
import { generate, getOne, listAll, upcomingEvents } from "../controllers/briefing.controller";
import { requireUser } from "../middleware/auth";

export const briefingRoutes = Router();

briefingRoutes.use(requireUser);
briefingRoutes.get("/", listAll);
briefingRoutes.get("/upcoming-events", upcomingEvents);
briefingRoutes.get("/:id", getOne);
briefingRoutes.post("/", generate);