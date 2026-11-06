import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  COMMITMENT_LIMIT,
  addDependency,
  checkCommitmentTitle,
  checkMatterTitle,
  countCommitments,
  createCommitment,
  isValidDate,
  listMatterTitles,
  listOpenForPrompt,
  type CreatedCommitment,
} from "../model/commitment.model";
import { containsSensitive } from "../model/memory.model";
import { logger } from "../utility/logger";
import { daysBetween, todayIn } from "../utility/priority";
import { getChatModel } from "./providers/llm";

export type SavedCommitment = CreatedCommitment;

const MIN_MESSAGE_CHARS = 15;
const MAX_MESSAGE_CHARS = 2000; // longer messages are mostly pasted text
const MAX_ITEMS_READ = 8;
const MAX_SAVED_PER_MESSAGE = 5;
const EXISTING_SHOWN = 40;
const MATTERS_SHOWN = 30;

const EXTRACTOR_PROMPT = [
  "You decide which commitments a personal secretary app should start tracking for its user.",
  "",
  "You are given TODAY (with the next 14 days), EXISTING (the user's open commitments, numbered E1, E2, ...), MATTERS (names of the user's existing areas) and MESSAGE (the user's latest message).",
  "",
  "A commitment is a specific thing the user says they must do, have promised to do, or are waiting for someone else to do. Example: \"I need to submit the DBMS assignment by Friday\" is a commitment. \"Rahul has to send me his notes\" is a commitment owed by someone else.",
  "",
  "Do NOT extract:",
  "- Questions, ideas, vague wishes (\"I should exercise more\"), opinions, or ordinary conversation.",
  "- Anything that EXISTING already covers.",
  "- Text the user pasted or quoted from someone else (emails, messages, documents). Only the user's own statements count.",
  "- Anything the user did not state. Never guess or infer.",
  "- Passwords, keys, tokens, card or ID numbers, or any other secret.",
  "",
  "For each commitment return:",
  "- title: a short action phrase under 100 characters, in the same language as MESSAGE.",
  "- matter: the ongoing area it belongs to, like \"DBMS exam\". Reuse a name from MATTERS exactly when it fits. Otherwise a short new name, or null.",
  "- dueDate: YYYY-MM-DD only if the user gave a date or a day (resolve words like Friday using TODAY). Otherwise null. Never guess a date.",
  "- impact: \"high\" only if the user says it is important, critical or cannot be missed. \"low\" only if they say it is minor. Otherwise null.",
  "- status: \"open\" for something the user must do. \"waiting\" for something someone else owes the user.",
  "- waitingOn: the person's name when status is \"waiting\", otherwise null.",
  "- dependsOn: null, or when the user says this cannot be done before another commitment, a reference to that one: \"E3\" for an existing commitment, or \"N2\" for the 2nd item in the list you are returning (numbered from 1 in the order you return them).",
  "",
  'Return ONLY a JSON object and nothing else, in this shape: {"commitments":[{"title":"...","matter":null,"dueDate":null,"impact":null,"status":"open","waitingOn":null,"dependsOn":null}]}',
  'Most messages contain no commitment. Returning {"commitments":[]} is the normal, correct answer.',
].join("\n");

const itemSchema = z.object({
  title: z.string(),
  matter: z.string().nullish(),
  dueDate: z.string().nullish(),
  impact: z.string().nullish(),
  status: z.string().nullish(),
  waitingOn: z.string().nullish(),
  dependsOn: z.string().nullish(),
});

// These two helpers also exist in memory.ts. They are tiny, so they are copied instead of shared.
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

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

// A calendar of the next 14 days, so the model does not have to work out what "Friday" means.
function upcomingDays(today: string): string {
  const lines: string[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.parse(`${today}T00:00:00Z`) + i * 86_400_000);
    const weekday = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    lines.push(`${weekday} ${d.toISOString().slice(0, 10)}${i === 0 ? " (today)" : ""}`);
  }
  return lines.join("\n");
}

// Accepts valid dates from a week ago to two years ahead. Anything else is treated as "no date".
function checkedDate(value: string | null | undefined, today: string): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!isValidDate(v)) return null;
  const d = daysBetween(today, v);
  return d < -7 || d > 730 ? null : v;
}

function resolveRef(
  ref: string | null | undefined,
  self: number,
  existing: { id: string }[],
  ids: (string | null)[],
): string | null {
  const m = /^([EN])(\d+)$/i.exec((ref ?? "").trim());
  if (!m) return null;
  const n = Number(m[2]);
  if (m[1]?.toUpperCase() === "E") return existing[n - 1]?.id ?? null;
  return n - 1 === self ? null : (ids[n - 1] ?? null);
}

// Best effort. NEVER throws: a tracking problem must not affect the chat.
export async function extractCommitments(input: {
  userId: string;
  conversationId: string;
  messageId: string;
  message: string;
  timezone: string;
}): Promise<SavedCommitment[]> {
  try {
    const message = input.message.trim();
    if (message.length < MIN_MESSAGE_CHARS || message.length > MAX_MESSAGE_CHARS) return [];
    if (containsSensitive(message)) return [];

    const total = await countCommitments(input.userId);
    if (total >= COMMITMENT_LIMIT) return [];

    const today = todayIn(input.timezone);
    const existing = await listOpenForPrompt(input.userId, EXISTING_SHOWN);
    const matterTitles = await listMatterTitles(input.userId, MATTERS_SHOWN);

    const existingText = existing.length ? existing.map((c, i) => `E${i + 1}. ${c.title}`).join("\n") : "none";
    const mattersText = matterTitles.length ? matterTitles.map((m) => `- ${m}`).join("\n") : "none";

    const response = await getChatModel().invoke(
      [
        new SystemMessage(EXTRACTOR_PROMPT),
        new HumanMessage(
          `TODAY:\n${upcomingDays(today)}\n\nEXISTING:\n${existingText}\n\nMATTERS:\n${mattersText}\n\nMESSAGE:\n<<<\n${message}\n>>>`,
        ),
      ],
      { signal: AbortSignal.timeout(25_000) },
    );

    const parsed = parseJsonObject(textOf(response.content)) as { commitments?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.commitments)) {
      logger.warn("Commitment extractor returned no usable JSON.");
      return [];
    }

    const source = {
      type: "chat_message" as const,
      conversationId: input.conversationId,
      messageId: input.messageId,
      excerpt: message.slice(0, 200),
    };

    const items = parsed.commitments.slice(0, MAX_ITEMS_READ);
    const ids: (string | null)[] = []; // position in the model's list -> saved id
    const refs: (string | null)[] = [];
    const saved: SavedCommitment[] = [];

    for (let i = 0; i < items.length; i++) {
      ids.push(null);
      refs.push(null);
      if (saved.length >= MAX_SAVED_PER_MESSAGE || total + saved.length >= COMMITMENT_LIMIT) continue;

      const result = itemSchema.safeParse(items[i]);
      if (!result.success) continue;
      const item = result.data;

      const title = clean(item.title);
      if (checkCommitmentTitle(title) !== null) continue;

      let matterTitle: string | null = item.matter ? clean(item.matter) : null;
      if (matterTitle && checkMatterTitle(matterTitle) !== null) matterTitle = null;

      const status: "open" | "waiting" = item.status?.toLowerCase().trim() === "waiting" ? "waiting" : "open";
      let waitingOn: string | null = status === "waiting" && item.waitingOn ? clean(item.waitingOn).slice(0, 60) : null;
      if (waitingOn && containsSensitive(waitingOn)) waitingOn = null;

      const impactText = item.impact?.toLowerCase().trim();
      const impact = impactText === "high" || impactText === "low" ? impactText : undefined;

      const row = await createCommitment(
        input.userId,
        { title, dueDate: checkedDate(item.dueDate, today), impact, status, waitingOn, matterTitle },
        source,
        "second",
      );
      if (row) {
        ids[i] = row.id;
        refs[i] = item.dependsOn ?? null;
        saved.push(row);
      }
    }

    // Links come last, because they can point at items created in this same message.
    for (let i = 0; i < ids.length; i++) {
      const fromId = ids[i];
      if (!fromId) continue;
      const toId = resolveRef(refs[i], i, existing, ids);
      if (toId) await addDependency(input.userId, fromId, toId);
    }

    return saved;
  } catch (err) {
    logger.error("Commitment extraction failed:", err instanceof Error ? err.message : err);
    return [];
  }
}