import { Router } from "express";
import { create, getOne, listAll, remove, reply } from "../controllers/conversation.controller";
import { requireUser } from "../middleware/auth";

export const conversationRoutes = Router();

conversationRoutes.use(requireUser);
conversationRoutes.get("/", listAll);
conversationRoutes.post("/", create);
conversationRoutes.get("/:id", getOne);
conversationRoutes.delete("/:id", remove);
conversationRoutes.post("/:id/reply", reply);