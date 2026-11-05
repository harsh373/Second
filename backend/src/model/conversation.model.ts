import { and, desc, eq } from "drizzle-orm";
import { db } from "../utility/db";
import { conversations, messages, userPreferences } from "../../../database/schema/index";

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;

export async function listConversations(userId: string, limit = 50) {
  return db
    .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(limit);
}

export async function createConversation(userId: string): Promise<Conversation> {
  const [row] = await db.insert(conversations).values({ userId }).returning();
  if (!row) throw new Error("Failed to create conversation");
  return row;
}

// The ownership check. Returns null if the conversation does not exist OR belongs to someone else.
export async function getConversation(userId: string, id: string): Promise<Conversation | null> {
  const [row] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .limit(1);
  return row ?? null;
}

// Newest N messages, returned oldest-first. Call getConversation() first to verify ownership.
export async function getRecentMessages(conversationId: string, limit: number): Promise<Message[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.reverse();
}

export async function addMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
): Promise<Message> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(messages).values({ conversationId, role, content }).returning();
    if (!row) throw new Error("Failed to save message");
    await tx.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));
    return row;
  });
}

export async function setConversationTitle(conversationId: string, title: string): Promise<void> {
  await db.update(conversations).set({ title }).where(eq(conversations.id, conversationId));
}

// Messages are removed automatically (ON DELETE CASCADE). Returns false if it was not the user's.
export async function deleteConversation(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
    .returning({ id: conversations.id });
  return rows.length > 0;
}

export async function getChatPreferences(userId: string) {
  const [row] = await db
    .select({
      timezone: userPreferences.timezone,
      userType: userPreferences.userType,
      communicationStyle: userPreferences.communicationStyle,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row ?? null;
}