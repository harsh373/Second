import { Router } from "express";
import * as desk from "../controllers/desk.controller";
import { requireUser } from "../middleware/auth";

export const deskRoutes = Router();

deskRoutes.use(requireUser);
deskRoutes.get("/", desk.get);