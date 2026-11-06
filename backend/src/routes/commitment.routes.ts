import { Router } from "express";
import * as commitment from "../controllers/commitment.controller";
import { requireUser } from "../middleware/auth";

export const commitmentRoutes = Router();

commitmentRoutes.use(requireUser);
commitmentRoutes.get("/", commitment.list);
commitmentRoutes.post("/", commitment.create);
commitmentRoutes.patch("/:id", commitment.update);
commitmentRoutes.delete("/:id", commitment.remove);