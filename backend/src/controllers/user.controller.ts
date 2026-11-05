import type { RequestHandler } from "express";
import { z } from "zod";
import { getUserWithPreferences, saveProfile } from "../model/user.model";
import { AppError } from "../utility/AppError";

function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const profileSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(80),
  timezone: z.string().refine(isValidTimezone, "Invalid timezone"),
  userType: z.enum(["student", "builder", "other"]),
  communicationStyle: z.enum(["concise", "detailed"]),
});

async function loadMe(userId: string) {
  const row = await getUserWithPreferences(userId);
  if (!row) throw new AppError(404, "User not found", "USER_NOT_FOUND");
  const { user, preferences } = row;
  return {
    user: { id: user.id, email: user.email, fullName: user.fullName, imageUrl: user.imageUrl },
    preferences: {
      timezone: preferences?.timezone ?? "UTC",
      userType: preferences?.userType ?? null,
      communicationStyle: preferences?.communicationStyle ?? "concise",
    },
    onboarded: Boolean(preferences?.onboardingCompletedAt),
  };
}

export const getMe: RequestHandler = async (req, res) => {
  res.json(await loadMe(req.user!.id));
};

// Used by onboarding, and reusable later as the "edit profile" endpoint.
export const updateProfile: RequestHandler = async (req, res) => {
  const input = profileSchema.parse(req.body);
  await saveProfile(req.user!.id, input);
  res.json(await loadMe(req.user!.id));
};