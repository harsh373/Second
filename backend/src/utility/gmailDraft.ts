import { google, type gmail_v1 } from "googleapis";
import type { DraftPayload } from "../../../database/schema/approvals";
import { AppError } from "./AppError";
import { getThread, isAutomatedAddress, type Participant } from "./gmail";
import { callGoogle } from "./googleCall";

const SUBJECT_MAX = 200;
const MESSAGE_ID = /^<[^<>\s]{1,200}>$/;
const EMAIL = /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/;
const EMAIL_ANYWHERE = /[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+/g;

export interface ReplyContext {
  to: string;
  subject: string;
  inReplyTo: string;
  references: string;
  sourceUrl: string;
}

// What the user approved, used to check a draft before it is sent and the sent message afterwards.
export type ApprovedMessage = Pick<DraftPayload, "threadId" | "to" | "subject" | "body">;

function cleanLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headerValue(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string | null {
  const found = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value?.trim() || null;
}

// Works out who to reply to and how to thread the reply, from the real thread. The AI never chooses these.
export async function getReplyContext(userId: string, threadId: string): Promise<ReplyContext> {
  const thread = await getThread(userId, threadId);
  const messages = thread.messages.filter((m) => !m.labelIds.includes("DRAFT"));
  const last = messages[messages.length - 1];
  if (!last) throw new AppError(404, "That thread has no messages to reply to.", "THREAD_EMPTY");

  const lastInbound = [...messages].reverse().find((m) => !m.fromUser && m.from !== null);
  let target: Participant | null;
  if (!last.fromUser) target = last.from;
  else if (last.to.length === 1) target = last.to[0] ?? null;
  else target = lastInbound?.from ?? null;

  if (!target) {
    throw new AppError(
      400,
      "Could not tell who to reply to in this thread. Tell the user to write this reply themselves.",
      "NO_RECIPIENT",
    );
  }
  if (isAutomatedAddress(target.email) || (!last.fromUser && last.automated)) {
    throw new AppError(
      400,
      "The other side of this thread looks automated (no-reply), so no draft was proposed.",
      "AUTOMATED_RECIPIENT",
    );
  }
  if (!EMAIL.test(target.email)) {
    throw new AppError(400, "The recipient address in this thread looks invalid.", "NO_RECIPIENT");
  }

  const rawSubject = cleanLine(thread.subject);
  if (rawSubject === "" || rawSubject === "(no subject)") {
    throw new AppError(400, "This thread has no subject, so a threaded draft cannot be made.", "NO_SUBJECT");
  }
  const subject = /^re:/i.test(rawSubject) ? rawSubject : `Re: ${rawSubject}`;
  if (subject.length > SUBJECT_MAX) {
    throw new AppError(400, "The subject of this thread is too long to reply to.", "NO_SUBJECT");
  }

  // The reply must point at the latest message through the Message-ID header, or Gmail will not thread it.
  const headers = await callGoogle(userId, "gmail", async ({ client }) => {
    const gmail = google.gmail({ version: "v1", auth: client });
    const res = await gmail.users.messages.get({
      userId: "me",
      id: last.id,
      format: "metadata",
      metadataHeaders: ["Message-ID", "References"],
    });
    return res.data.payload?.headers ?? [];
  });

  const inReplyTo = headerValue(headers, "Message-ID") ?? "";
  if (!MESSAGE_ID.test(inReplyTo)) {
    throw new AppError(
      502,
      "Could not read the Message-ID of the latest email, so the reply cannot be threaded.",
      "NO_MESSAGE_ID",
    );
  }
  const prior = (headerValue(headers, "References") ?? "")
    .split(/\s+/)
    .filter((t) => MESSAGE_ID.test(t))
    .slice(-5);
  const refs = [...prior, inReplyTo];
  while (refs.join(" ").length > 900 && refs.length > 1) refs.shift();

  return { to: target.email, subject, inReplyTo, references: refs.join(" "), sourceUrl: thread.sourceUrl };
}

// Non-ASCII subjects are sent as an RFC 2047 encoded word.
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function decodeHeader(value: string): string {
  return value
    .replace(/(\?=)\s+(=\?UTF-8\?B\?)/gi, "$1$2")
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b64: string) => Buffer.from(b64, "base64").toString("utf8"));
}

function buildRaw(p: DraftPayload): string {
  for (const v of [p.to, p.subject, p.inReplyTo, p.references]) {
    if (/[\r\n]/.test(v)) throw new AppError(400, "A draft header contained a line break.", "INVALID_PROPOSAL");
  }
  const body = Buffer.from(p.body.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  const lines = [
    `To: ${p.to}`,
    `Subject: ${encodeHeader(p.subject)}`,
    `In-Reply-To: ${p.inReplyTo}`,
    `References: ${p.references}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

// Creates a DRAFT in the user's Gmail. Nothing is sent by this function.
export function createReplyDraft(userId: string, p: DraftPayload): Promise<{ draftId: string }> {
  const raw = buildRaw(p);
  return callGoogle(userId, "gmail_compose", async ({ client }) => {
    const gmail = google.gmail({ version: "v1", auth: client });
    const res = await gmail.users.drafts.create({
      userId: "me",
      requestBody: { message: { raw, threadId: p.threadId } },
    });
    const draftId = res.data.id;
    if (!draftId) throw new AppError(502, "Gmail did not return a draft id.", "GOOGLE_UNAVAILABLE");
    return { draftId };
  });
}

function plainTextOf(part: gmail_v1.Schema$MessagePart | undefined): string | null {
  if (!part) return null;
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  for (const child of part.parts ?? []) {
    const found = plainTextOf(child);
    if (found !== null) return found;
  }
  return null;
}

const normalize = (s: string) => s.replace(/\r\n/g, "\n").trim();

// Reads the draft back from Gmail and compares it with what the user approved.
export function verifyDraft(userId: string, draftId: string, p: DraftPayload): Promise<boolean> {
  return callGoogle(userId, "gmail_compose", async ({ client }) => {
    const gmail = google.gmail({ version: "v1", auth: client });
    const res = await gmail.users.drafts.get({ userId: "me", id: draftId, format: "full" });
    const msg = res.data.message;
    if (!msg) return false;
    if (!(msg.labelIds ?? []).includes("DRAFT")) return false;
    if (msg.threadId !== p.threadId) return false;

    const headers = msg.payload?.headers ?? [];
    const to = headerValue(headers, "To");
    const subject = headerValue(headers, "Subject");
    if (!to || !to.toLowerCase().includes(p.to.toLowerCase())) return false;
    if (!subject || decodeHeader(subject).trim() !== p.subject) return false;

    const text = plainTextOf(msg.payload);
    return text !== null && normalize(text) === normalize(p.body);
  });
}

// ---- Sending (only ever called for a draft the user approved, after a second approval) ----

function addressesOf(value: string): string[] {
  return (value.match(EMAIL_ANYWHERE) ?? []).map((a) => a.toLowerCase());
}

// Strict comparison used before AND after a send. Returns null when everything matches, otherwise a plain reason.
// It is stricter than verifyDraft: exactly one recipient, no Cc and no Bcc, same thread, subject and body.
function compareMessage(
  msg: gmail_v1.Schema$Message | undefined,
  p: ApprovedMessage,
  requiredLabel: "DRAFT" | "SENT",
): string | null {
  if (!msg) return "Gmail returned no message.";
  if (!(msg.labelIds ?? []).includes(requiredLabel)) {
    return requiredLabel === "DRAFT"
      ? "The draft is no longer a draft in Gmail."
      : "The message does not have the SENT label.";
  }
  if (msg.threadId !== p.threadId) return "The message is not in the thread that was approved.";

  const headers = msg.payload?.headers ?? [];
  const to = headerValue(headers, "To");
  const recipients = to ? addressesOf(to) : [];
  if (recipients.length !== 1 || recipients[0] !== p.to.toLowerCase()) {
    return "The recipients are not exactly the one that was approved.";
  }
  for (const name of ["Cc", "Bcc"]) {
    const value = headerValue(headers, name);
    if (value && addressesOf(value).length > 0) return "A Cc or Bcc recipient was added.";
  }

  const subject = headerValue(headers, "Subject");
  if (!subject || decodeHeader(subject).trim() !== p.subject) return "The subject is not the one that was approved.";

  const text = plainTextOf(msg.payload);
  if (text === null || normalize(text) !== normalize(p.body)) return "The text is not the one that was approved.";
  return null;
}

// Re-reads the draft from Gmail right before sending. Returns null if it still matches exactly what was approved.
export function verifyDraftForSend(userId: string, draftId: string, p: ApprovedMessage): Promise<string | null> {
  return callGoogle(userId, "gmail_compose", async ({ client }) => {
    const gmail = google.gmail({ version: "v1", auth: client });
    let msg: gmail_v1.Schema$Message | undefined;
    try {
      const res = await gmail.users.drafts.get({ userId: "me", id: draftId, format: "full" });
      msg = res.data.message ?? undefined;
    } catch (err) {
      if ((err as { code?: number | string } | null)?.code === 404) {
        return "The draft no longer exists in Gmail (it was sent or deleted).";
      }
      throw err;
    }
    return compareMessage(msg, p, "DRAFT");
  });
}

// Sends an existing Gmail draft. This is the only send call in the app. It must only be reached from
// the approval runner, after the user approved this exact send and verifyDraftForSend passed.
export function sendDraft(userId: string, draftId: string): Promise<{ messageId: string }> {
  return callGoogle(userId, "gmail_compose", async ({ client }) => {
    const gmail = google.gmail({ version: "v1", auth: client });
    const res = await gmail.users.drafts.send({ userId: "me", requestBody: { id: draftId } });
    const messageId = res.data.id;
    if (!messageId) throw new AppError(502, "Gmail did not return an id for the sent email.", "GOOGLE_UNAVAILABLE");
    return { messageId };
  });
}

// Reads the sent message back from Gmail and checks it has the SENT label and matches what was approved.
export function verifySent(userId: string, messageId: string, p: ApprovedMessage): Promise<string | null> {
  return callGoogle(userId, "gmail", async ({ client }) => {
    const gmail = google.gmail({ version: "v1", auth: client });
    const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" });
    return compareMessage(res.data, p, "SENT");
  });
}