import { Router } from "express";
import { listThreads, threadById, threadsByPerson, unanswered } from "../controllers/gmail.controller";
import { requireUser } from "../middleware/auth";

export const gmailRoutes = Router();

gmailRoutes.use(requireUser);
gmailRoutes.get("/threads", listThreads);
gmailRoutes.get("/threads/:threadId", threadById);
gmailRoutes.get("/by-person", threadsByPerson);
gmailRoutes.get("/unanswered", unanswered);