import { clerkClient, getAuth } from "@clerk/express";
import type { RequestHandler } from "express";
import { createUserWithPreferences, findUserByClerkId, type User } from "../model/user.model";
import { AppError } from "../utility/AppError";

// Lets controllers read req.user with full type safety.
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

// 1. Rejects requests without a valid Clerk session.
// 2. Finds the matching local user, creating it on first sight (this is the user sync).
// 3. Attaches it as req.user, so controllers only ever act on the signed-in user.
export const requireUser: RequestHandler = async (req, _res, next) => {
  const { userId: clerkId } = getAuth(req);
  if (!clerkId) throw new AppError(401, "Please sign in", "UNAUTHENTICATED");

  let user = await findUserByClerkId(clerkId);

  if (!user) {
    const clerkUser = await clerkClient.users.getUser(clerkId);
    const email =
      clerkUser.primaryEmailAddress?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress;
    if (!email) throw new AppError(400, "Your account has no email address", "NO_EMAIL");

    await createUserWithPreferences({
      clerkId,
      email,
      fullName: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null,
      imageUrl: clerkUser.imageUrl || null,
    });
    user = await findUserByClerkId(clerkId);
  }

  if (!user) throw new AppError(500, "Could not load your account", "USER_SYNC_FAILED");

  req.user = user;
  next();
};