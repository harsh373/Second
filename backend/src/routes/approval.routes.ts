import { Router } from "express";
import { approve, list, reject, send } from "../controllers/approval.controller";
import { requireUser } from "../middleware/auth";

export const approvalRoutes = Router();

approvalRoutes.use(requireUser);
approvalRoutes.get("/", list);
approvalRoutes.post("/:id/approve", approve);
approvalRoutes.post("/:id/reject", reject);
approvalRoutes.post("/:id/send", send);