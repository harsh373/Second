import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { containsSensitive } from "../model/memory.model";
import {
  checkLabel,
  checkPersonName,
  normalizeName,
  saveStatedRelationship,
  type StatedRelationship,
} from "../model/people.model";
import { logger } from "../utility/logger";
import { getChatModel } from "./providers/llm";

export type SavedPerson = StatedRelationship;

const MIN_MESSAGE_CHARS = 15;
const MAX_MESSAGE_CHARS = 2000; // longer messages are mostly pasted text
const MAX_ITEMS_READ = 6;
const MAX_SAVED_PER_MESSAGE = 3;

const EXTRACTOR_PROMPT = [
  "You decide which people a personal secretary app should note, based on what its user says about the people in their life.",
  "",
  "You are given MESSAGE, the user's latest message.",
  "",
  'Return a person ONLY when the user names that person AND states, in their own words, how that person relates to them. Examples: "Rahul is my project partner", "my mentor, Dr. Mehta", "Priya (my roommate) is moving out".',
  "",
  "Do NOT return:",
  "- A person with no stated relationship.",
  "- Anything the user did not state. Never guess, infer or speculate about relationships, feelings or intentions.",
  "- The user themselves, groups, companies, or public figures mentioned in passing.",
  "- Text the user pasted or quoted from someone else (emails, messages, documents). Only the user's own statements count.",
  "- Passwords, keys, tokens, card or ID numbers, or any other secret.",
  "",
  "For each person return:",
  '- name: the person\'s name copied exactly as written in MESSAGE (no titles you added, no email addresses).',
  '- label: the relationship, copied from the wording in MESSAGE, lowercase, at most 5 words, without "my". Example: "project partner".',
  "",
  'Return ONLY a JSON object and nothing else, in this shape: {"people":[{"name":"...","label":"..."}]}',
  'Most messages name no relationship. Returning {"people":[]} is the normal, correct answer.',
].join("\n");

const itemSchema = z.object({ name: z.string(), label: z.string() });

// These two helpers also exist in memory.ts and commitments.ts. They are tiny, so they are copied instead of shared.
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

// Best effort. NEVER throws: a people problem must not affect the chat.
export async function extractRelationships(input: { userId: string; message: string }): Promise<SavedPerson[]> {
  try {
    const message = input.message.trim();
    if (message.length < MIN_MESSAGE_CHARS || message.length > MAX_MESSAGE_CHARS) return [];
    if (message.endsWith("?")) return []; // a question is not a statement
    if (containsSensitive(message)) return [];

    const response = await getChatModel().invoke(
      [new SystemMessage(EXTRACTOR_PROMPT), new HumanMessage(`MESSAGE:\n<<<\n${message}\n>>>`)],
      { signal: AbortSignal.timeout(25_000) },
    );

    const parsed = parseJsonObject(textOf(response.content)) as { people?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.people)) {
      logger.warn("People extractor returned no usable JSON.");
      return [];
    }

    const haystack = normalizeName(message);
    const excerpt = message.slice(0, 200);
    const saved: SavedPerson[] = [];

    for (const item of parsed.people.slice(0, MAX_ITEMS_READ)) {
      if (saved.length >= MAX_SAVED_PER_MESSAGE) break;
      const result = itemSchema.safeParse(item);
      if (!result.success) continue;

      const name = result.data.name.replace(/\s+/g, " ").trim();
      const label = result.data.label
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^(my|his|her|their)\s+/i, "");
      if (checkPersonName(name) !== null || checkLabel(label) !== null) continue;

      // Evidence check: both the name and the label wording must literally appear in the user's message.
      if (!haystack.includes(normalizeName(name)) || !haystack.includes(normalizeName(label))) continue;

      const row = await saveStatedRelationship(input.userId, { name, label }, excerpt);
      if (row) saved.push(row);
    }
    return saved;
  } catch (err) {
    logger.error("People extraction failed:", err instanceof Error ? err.message : err);
    return [];
  }
}