import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  MEMORY_CATEGORIES,
  MEMORY_LIMIT,
  checkMemoryContent,
  containsSensitive,
  countMemories,
  createMemory,
  listMemoriesForPrompt,
  normalizeMemory,
  searchMemories,
  updateMemory,
} from "../model/memory.model";
import { logger } from "../utility/logger";
import { getChatModel } from "./providers/llm";

export interface PromptMemory {
  category: string;
  content: string;
}

export interface SavedMemory {
  id: string;
  category: string;
  content: string;
  action: "created" | "updated";
}

// ---------------- Retriever ----------------

const ALL_IF_AT_MOST = 15; // small memory: include everything
const CORE_MAX = 8; // large memory: identity + preferences are always included
const MATCH_MAX = 6; // plus the best matches for the current message

function wordsOf(text: string): string[] {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3);
  return [...new Set(words)].slice(0, 12);
}

export async function retrieveMemories(userId: string, query: string): Promise<PromptMemory[]> {
  const total = await countMemories(userId);
  if (total === 0) return [];
  if (total <= ALL_IF_AT_MOST) return listMemoriesForPrompt(userId, { limit: ALL_IF_AT_MOST });

  const core = await listMemoriesForPrompt(userId, { categories: ["identity", "preferences"], limit: CORE_MAX });
  const found = await searchMemories(userId, wordsOf(query), CORE_MAX + MATCH_MAX);
  const coreIds = new Set(core.map((m) => m.id));
  const matches = found.filter((m) => !coreIds.has(m.id)).slice(0, MATCH_MAX);
  return [...core, ...matches];
}

// ---------------- Extractor ----------------

const MIN_MESSAGE_CHARS = 15;
const MAX_MESSAGE_CHARS = 2000; // longer messages are mostly pasted text, not the user talking about themselves
const MAX_SAVED_PER_MESSAGE = 3;
const NOTES_SHOWN_TO_EXTRACTOR = 60;

// People and how they relate to the user are handled by the People feature, not by memory.
const EXTRACTED_CATEGORIES = MEMORY_CATEGORIES.filter((c) => c !== "relationships");

const EXTRACTOR_PROMPT = [
  "You decide what a personal secretary app should remember about its user for the long term.",
  "",
  "You are given NOTES (what the app already remembers, numbered) and MESSAGE (the user's latest message).",
  "",
  "Extract only durable facts that the user states about themselves in MESSAGE, in their own words. Durable means it will probably still be true and useful weeks from now: who they are, stable preferences, goals, ongoing responsibilities, and important history.",
  "",
  "Do NOT extract:",
  "- Anything the user did not state. Never guess, infer or speculate, and never guess other people's feelings or intentions.",
  "- One-off tasks, questions, requests, plans for today, or moods.",
  "- Who other people are or how they relate to the user (for example \"Rahul is my project partner\"). A separate feature handles that.",
  "- Text the user pasted or quoted from someone else (emails, messages, documents). Only the user's own statements about themselves count.",
  "- Passwords, keys, tokens, card or ID numbers, or any other secret.",
  "- Health, sexuality, religion, politics or similar sensitive details, unless the user explicitly asks you to remember them.",
  "- Anything a note already covers.",
  "",
  `Categories: ${EXTRACTED_CATEGORIES.join(", ")}.`,
  "",
  'Write each fact as one short, plain statement about the user, under 160 characters, in the same language as MESSAGE. Examples: "Prefers morning meetings", "Wants to finish a thesis this year".',
  'If MESSAGE changes or contradicts a note, return the new fact with "replaces" set to that note\'s number. Otherwise set "replaces" to null.',
  "",
  'Return ONLY a JSON object and nothing else, in this shape: {"memories":[{"category":"preferences","content":"...","replaces":null}]}',
  'Most messages contain nothing worth remembering. Returning {"memories":[]} is the normal, correct answer.',
].join("\n");

const candidateSchema = z.object({
  category: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase().trim() : v),
    z.enum(MEMORY_CATEGORIES),
  ),
  content: z.string(),
  replaces: z.number().int().nullish(),
});

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        const b = block as { type?: string; text?: string } | null;
        return b?.type === "text" ? (b.text ?? "") : "";
      })
      .join("");
  }
  return "";
}

// Takes the first { to the last } so code fences or stray words around the JSON do not matter.
function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Best effort. NEVER throws: a memory problem must not affect the chat.
export async function extractMemories(input: {
  userId: string;
  conversationId: string;
  messageId: string;
  message: string;
}): Promise<SavedMemory[]> {
  try {
    const message = input.message.trim();
    if (message.length < MIN_MESSAGE_CHARS || message.length > MAX_MESSAGE_CHARS) return [];
    if (containsSensitive(message)) return []; // do not even try when the message holds a secret

    const total = await countMemories(input.userId);
    if (total >= MEMORY_LIMIT) return [];

    const existing = await listMemoriesForPrompt(input.userId, { limit: NOTES_SHOWN_TO_EXTRACTOR });
    const notes = existing.length
      ? existing.map((m, i) => `${i + 1}. [${m.category}] ${m.content}`).join("\n")
      : "none";

    const response = await getChatModel().invoke(
      [
        new SystemMessage(EXTRACTOR_PROMPT),
        new HumanMessage(`NOTES:\n${notes}\n\nMESSAGE:\n<<<\n${message}\n>>>`),
      ],
      { signal: AbortSignal.timeout(25_000) },
    );

    const parsed = parseJsonObject(textOf(response.content)) as { memories?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.memories)) {
      logger.warn("Memory extractor returned no usable JSON.");
      return [];
    }

    const source = {
      type: "chat_message" as const,
      conversationId: input.conversationId,
      messageId: input.messageId,
      excerpt: message.slice(0, 200),
    };

    const saved: SavedMemory[] = [];
    let created = 0;
    for (const item of parsed.memories) {
      if (saved.length >= MAX_SAVED_PER_MESSAGE) break;
      const candidate = candidateSchema.safeParse(item);
      if (!candidate.success) continue;
      if (candidate.data.category === "relationships") continue; // owned by the People feature now

      const content = candidate.data.content.replace(/\s+/g, " ").trim();
      if (checkMemoryContent(content) !== null) continue;

      const n = candidate.data.replaces;
      const target = typeof n === "number" ? existing[n - 1] : undefined;

      if (target) {
        if (normalizeMemory(target.content) === normalizeMemory(content)) continue;
        const row = await updateMemory(
          input.userId,
          target.id,
          { category: candidate.data.category, content },
          source,
          "second",
        );
        if (row) saved.push({ ...row, action: "updated" });
      } else {
        if (total + created >= MEMORY_LIMIT) break;
        const row = await createMemory(input.userId, { category: candidate.data.category, content }, source, "second");
        if (row) {
          created += 1;
          saved.push({ ...row, action: "created" });
        }
      }
    }
    return saved;
  } catch (err) {
    logger.error("Memory extraction failed:", err instanceof Error ? err.message : err);
    return [];
  }
}