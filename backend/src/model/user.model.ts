import { eq, sql } from "drizzle-orm";
import { db } from "../utility/db";
import { userPreferences, users } from "../../../database/schema/index";

export type User = typeof users.$inferSelect;

export async function findUserByClerkId(clerkId: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  return user ?? null;
}

// Creates the user and their default preferences together, or neither.
// onConflictDoNothing makes it safe if two first-time requests arrive at once.
export async function createUserWithPreferences(data: {
  clerkId: string;
  email: string;
  fullName: string | null;
  imageUrl: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(users)
      .values(data)
      .onConflictDoNothing({ target: users.clerkId })
      .returning({ id: users.id });
    if (inserted) await tx.insert(userPreferences).values({ userId: inserted.id });
  });
}

export async function getUserWithPreferences(userId: string) {
  const [row] = await db
    .select({ user: users, preferences: userPreferences })
    .from(users)
    .leftJoin(userPreferences, eq(userPreferences.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function saveProfile(
  userId: string,
  input: {
    fullName: string;
    timezone: string;
    userType: "student" | "builder" | "other";
    communicationStyle: "concise" | "detailed";
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ fullName: input.fullName }).where(eq(users.id, userId));
    await tx
      .insert(userPreferences)
      .values({
        userId,
        timezone: input.timezone,
        userType: input.userType,
        communicationStyle: input.communicationStyle,
        onboardingCompletedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          timezone: input.timezone,
          userType: input.userType,
          communicationStyle: input.communicationStyle,
          // Keep the first completion time when someone edits their profile later.
          onboardingCompletedAt: sql`coalesce(${userPreferences.onboardingCompletedAt}, now())`,
          updatedAt: new Date(),
        },
      });
  });
}