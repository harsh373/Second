import { Router } from "express";
import { availability, conflicts, eventById, events } from "../controllers/calendar.controller";
import { requireUser } from "../middleware/auth";

export const calendarRoutes = Router();

calendarRoutes.use(requireUser);
calendarRoutes.get("/events", events);
calendarRoutes.get("/events/:eventId", eventById);
calendarRoutes.get("/availability", availability);
calendarRoutes.get("/conflicts", conflicts);