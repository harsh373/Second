import { Router } from "express";
import * as memory from "../controllers/memory.controller";
import { requireUser } from "../middleware/auth";

export const memoryRoutes = Router();

memoryRoutes.use(requireUser);
memoryRoutes.get("/", memory.list);
memoryRoutes.post("/", memory.create);
memoryRoutes.delete("/:id", memory.remove);