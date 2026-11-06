import { Router } from "express";
import * as openLoop from "../controllers/openLoop.controller";
import { requireUser } from "../middleware/auth";

export const openLoopRoutes = Router();

openLoopRoutes.use(requireUser);
openLoopRoutes.get("/", openLoop.list);
openLoopRoutes.post("/scan", openLoop.scan);
openLoopRoutes.patch("/:id", openLoop.update);