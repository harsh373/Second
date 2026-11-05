import { Router } from "express";
import { getMe, updateProfile } from "../controllers/user.controller";
import { requireUser } from "../middleware/auth";

export const userRoutes = Router();

userRoutes.use(requireUser); // every route in this file needs a signed-in user

userRoutes.get("/me", getMe);
userRoutes.put("/me/profile", updateProfile);