import { Router } from "express";
import { list, refresh, remove, updateLabel } from "../controllers/people.controller";
import { requireUser } from "../middleware/auth";

export const peopleRoutes = Router();

peopleRoutes.use(requireUser);
peopleRoutes.get("/", list);
peopleRoutes.post("/refresh", refresh);
peopleRoutes.put("/:id/label", updateLabel);
peopleRoutes.delete("/:id", remove);