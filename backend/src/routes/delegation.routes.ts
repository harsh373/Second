import { Router } from "express";
import { change, create, list, remove } from "../controllers/delegation.controller";
import { requireUser } from "../middleware/auth";

export const delegationRoutes = Router();

delegationRoutes.use(requireUser);
delegationRoutes.get("/", list);
delegationRoutes.post("/", create);
delegationRoutes.patch("/:id", change);
delegationRoutes.delete("/:id", remove);