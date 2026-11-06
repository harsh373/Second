import { google, type gmail_v1 } from "googleapis";
import { callGoogle, googleStatus } from "./googleCall";

export interface Participant {
  name: string | null;
  email: string;
}

export interface GmailMessage {
  id: string;
  from: Participant | null;
  to: Participant[];
  cc: Participant[];
  date: string | null;
  snippet: string;
  bodyText: string;
  attachments: string[]; // filenames only, content is never read
  labelIds: string[];
  fromUser: boolean;
  automated: boolean; // bulk / no-reply / auto-generated
}

export interface GmailThread {
  id: string;
  subject: string;
  participants: Participant[];
  messages: GmailMessage[];
  lastMessageAt: string | null;
  sourceUrl: string;
}

export interface GmailThreadSummary {
  id: string;
  subject: string;
  snippet: string;
  from: Participant | null; // sender of the latest message
  lastMessageAt: string | null;
  messageCount: number;
  labelIds: string[];
  sourceUrl: string;
}

export interface UnansweredItem {
  threadId: string;
  subject: string;
  sourceUrl: string;
  lastMessage: { id: string; from: Participant | null; date: string; snippet: string };
  counterparts: Participant[]; // needsReply: who wrote to the user. waitingOn: who the user wrote to.
  daysSince: number;
  reason: string;
}

const META_HEADERS = ["From", "To", "Cc", "Subject", "Date", "List-Unsubscribe", "Precedence", "Auto-Submitted"];
const BODY_LIMIT = 20000;
const FETCH_CONCURRENCY = 5;
const SCAN_LIMIT = 40;
const DAY_MS = 86_400_000;
const BLOCKED_CATEGORIES = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];
const AUTOMATED_SENDER =
  /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster|bounces?|notifications?|alerts?|newsletter|automated)([-_.+][^@]*)?@/i;

// ---------- small helpers ----------

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | null {
  const found = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

// Splits "A <a@x.com>, \"B, C\" <b@x.com>" on commas that are not inside quotes or <>.
function splitAddresses(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let inAngle = false;
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes;
    if (!inQuotes && ch === "<") inAngle = true;
    if (!inQuotes && ch === ">") inAngle = false;
    if (ch === "," && !inQuotes && !inAngle) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseParticipant(raw: string): Participant | null {
  const withName = raw.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
  if (withName) {
    const email = (withName[2] ?? "").trim().toLowerCase();
    if (!email.includes("@")) return null;
    return { name: withName[1]?.trim() || null, email };
  }
  const bare = raw.trim().replace(/^"|"$/g, "");
  return bare.includes("@") ? { name: null, email: bare.toLowerCase() } : null;
}

function parseList(value: string | null): Participant[] {
  if (!value) return [];
  return splitAddresses(value)
    .map(parseParticipant)
    .filter((p): p is Participant => p !== null);
}

function decodeBody(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

interface BodyParts {
  plain: string[];
  html: string[];
  attachments: string[];
}

function collectParts(part: gmail_v1.Schema$MessagePart | undefined, acc: BodyParts = { plain: [], html: [], attachments: [] }) {
  if (!part) return acc;
  if (part.filename) {
    acc.attachments.push(part.filename); // attachment: record the name, skip the content
    return acc;
  }
  if (part.mimeType === "text/plain" && part.body?.data) acc.plain.push(decodeBody(part.body.data));
  else if (part.mimeType === "text/html" && part.body?.data) acc.html.push(decodeBody(part.body.data));
  for (const child of part.parts ?? []) collectParts(child, acc);
  return acc;
}

function sourceUrl(accountEmail: string, threadId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(accountEmail)}#all/${threadId}`;
}

// True for addresses that look like no-reply / notification senders (used to keep bots out of the people list).
export function isAutomatedAddress(email: string): boolean {
  return AUTOMATED_SENDER.test(email);
}

function parseMessage(msg: gmail_v1.Schema$Message, account: string, withBody: boolean): GmailMessage {
  const headers = msg.payload?.headers ?? undefined;
  const from = parseList(getHeader(headers, "From"))[0] ?? null;
  const labelIds = msg.labelIds ?? [];

  let date: string | null = null;
  if (msg.internalDate) date = new Date(Number(msg.internalDate)).toISOString();
  else {
    const parsed = Date.parse(getHeader(headers, "Date") ?? "");
    if (!Number.isNaN(parsed)) date = new Date(parsed).toISOString();
  }

  const parts = withBody ? collectParts(msg.payload) : { plain: [], html: [], attachments: [] };
  const rawBody = parts.plain.length > 0 ? parts.plain.join("\n\n") : htmlToText(parts.html.join("\n"));

  const precedence = getHeader(headers, "Precedence") ?? "";
  const autoSubmitted = getHeader(headers, "Auto-Submitted");
  const automated =
    Boolean(getHeader(headers, "List-Unsubscribe")) ||
    /bulk|list|junk/i.test(precedence) ||
    (autoSubmitted !== null && autoSubmitted.toLowerCase() !== "no") ||
    (from ? AUTOMATED_SENDER.test(from.email) : false);

  return {
    id: msg.id ?? "",
    from,
    to: parseList(getHeader(headers, "To")),
    cc: parseList(getHeader(headers, "Cc")),
    date,
    snippet: msg.snippet ?? "",
    bodyText: rawBody.trim().slice(0, BODY_LIMIT),
    attachments: parts.attachments,
    labelIds,
    fromUser: labelIds.includes("SENT") || from?.email === account,
    automated,
  };
}

function parseThread(thread: gmail_v1.Schema$Thread, account: string, withBody: boolean): GmailThread {
  const raw = thread.messages ?? [];
  const messages = raw.map((m) => parseMessage(m, account, withBody));
  const subject = getHeader(raw[0]?.payload?.headers ?? undefined, "Subject")?.trim() || "(no subject)";

  const seen = new Map<string, Participant>();
  for (const m of messages) {
    for (const p of [m.from, ...m.to, ...m.cc]) {
      if (p && !seen.has(p.email)) seen.set(p.email, p);
    }
  }

  return {
    id: thread.id ?? "",
    subject,
    participants: [...seen.values()],
    messages,
    lastMessageAt: messages[messages.length - 1]?.date ?? null,
    sourceUrl: sourceUrl(account, thread.id ?? ""),
  };
}

function summarize(t: GmailThread): GmailThreadSummary {
  const last = t.messages[t.messages.length - 1];
  return {
    id: t.id,
    subject: t.subject,
    snippet: last?.snippet ?? "",
    from: last?.from ?? null,
    lastMessageAt: t.lastMessageAt,
    messageCount: t.messages.length,
    labelIds: last?.labelIds ?? [],
    sourceUrl: t.sourceUrl,
  };
}

async function listThreadIds(gmail: gmail_v1.Gmail, q: string, maxResults: number, pageToken?: string) {
  const res = await gmail.users.threads.list({
    userId: "me",
    q: q || undefined,
    maxResults,
    pageToken,
  });
  return {
    ids: (res.data.threads ?? []).map((t) => t.id).filter((id): id is string => Boolean(id)),
    nextPageToken: res.data.nextPageToken ?? null,
  };
}

// A thread deleted between "list" and "get" is skipped instead of failing the whole request.
async function fetchMetadata(gmail: gmail_v1.Gmail, id: string, account: string): Promise<GmailThread | null> {
  try {
    const res = await gmail.users.threads.get({
      userId: "me",
      id,
      format: "metadata",
      metadataHeaders: META_HEADERS,
    });
    return parseThread(res.data, account, false);
  } catch (err) {
    if (googleStatus(err) === 404) return null;
    throw err;
  }
}

// ---------- public service functions (each one is a future agent tool) ----------

export interface SearchThreadsInput {
  query?: string | undefined;
  maxResults?: number | undefined;
  pageToken?: string | undefined;
}

export function searchThreads(userId: string, input: SearchThreadsInput = {}) {
  return callGoogle(userId, "gmail", async ({ client, integration }) => {
    const gmail = google.gmail({ version: "v1", auth: client });
    const account = integration.accountEmail.toLowerCase();
    const query = input.query ?? "";
    const { ids, nextPageToken } = await listThreadIds(gmail, query, input.maxResults ?? 15, input.pageToken);
    const threads = await mapLimit(ids, FETCH_CONCURRENCY, (id) => fetchMetadata(gmail, id, account));
    return {
      query,
      nextPageToken,
      threads: threads.filter((t): t is GmailThread => t !== null).map(summarize),
    };
  });
}

export function getThread(userId: string, threadId: string): Promise<GmailThread> {
  return callGoogle(userId, "gmail", async ({ client, integration }) => {
    const gmail = google.gmail({ version: "v1", auth: client });
    const res = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
    return parseThread(res.data, integration.accountEmail.toLowerCase(), true);
  });
}

// Re-reads specific threads (headers only, no bodies). A thread that no longer exists comes back as null.
export function getThreadsMetadata(
  userId: string,
  threadIds: string[],
): Promise<{ id: string; thread: GmailThread | null }[]> {
  return callGoogle(userId, "gmail", async ({ client, integration }) => {
    const gmail = google.gmail({ version: "v1", auth: client });
    const account = integration.accountEmail.toLowerCase();
    const threads = await mapLimit(threadIds, FETCH_CONCURRENCY, (id) => fetchMetadata(gmail, id, account));
    return threadIds.map((id, i) => ({ id, thread: threads[i] ?? null }));
  });
}

// Recent threads, headers only (no bodies), skipping promotions / social / updates / forums.
// Used by the People refresh. Also returns the user's own address so callers can leave it out.
export function listRecentThreads(
  userId: string,
  options: { sinceDays?: number | undefined; maxThreads?: number | undefined } = {},
): Promise<{ account: string; sinceDays: number; threads: GmailThread[] }> {
  const sinceDays = options.sinceDays ?? 30;
  const maxThreads = options.maxThreads ?? 100;
  return callGoogle(userId, "gmail", async ({ client, integration }) => {
    const gmail = google.gmail({ version: "v1", auth: client });
    const account = integration.accountEmail.toLowerCase();
    const query = `newer_than:${sinceDays}d -category:promotions -category:social -category:updates -category:forums`;
    const { ids } = await listThreadIds(gmail, query, maxThreads);
    const fetched = await mapLimit(ids, FETCH_CONCURRENCY, (id) => fetchMetadata(gmail, id, account));
    return { account, sinceDays, threads: fetched.filter((t): t is GmailThread => t !== null) };
  });
}

export function searchByPerson(userId: string, person: string, maxResults = 15) {
  const cleaned = person.replace(/["()\\]/g, " ").trim();
  const term = cleaned.includes("@") ? cleaned : `"${cleaned}"`;
  const query = `(from:${term} OR to:${term} OR cc:${term})`;
  return searchThreads(userId, { query, maxResults });
}

export interface UnansweredOptions {
  sinceDays?: number | undefined;
  waitingDays?: number | undefined;
}

export function findUnansweredThreads(userId: string, options: UnansweredOptions = {}) {
  const sinceDays = options.sinceDays ?? 14;
  const waitingDays = options.waitingDays ?? 3;

  return callGoogle(userId, "gmail", async ({ client, integration }) => {
    const gmail = google.gmail({ version: "v1", auth: client });
    const account = integration.accountEmail.toLowerCase();
    const now = Date.now();

    const inboxQuery = `in:inbox newer_than:${sinceDays}d -category:promotions -category:social -category:updates -category:forums`;
    const sentQuery = `in:sent newer_than:${sinceDays}d`;
    const [inbox, sent] = await Promise.all([
      listThreadIds(gmail, inboxQuery, SCAN_LIMIT),
      listThreadIds(gmail, sentQuery, SCAN_LIMIT),
    ]);

    const uniqueIds = [...new Set([...inbox.ids, ...sent.ids])];
    const fetched = await mapLimit(uniqueIds, FETCH_CONCURRENCY, (id) => fetchMetadata(gmail, id, account));
    const byId = new Map<string, GmailThread>();
    for (const t of fetched) if (t) byId.set(t.id, t);

    const needsReply: UnansweredItem[] = [];
    const waitingOn: UnansweredItem[] = [];

    const toItem = (
      t: GmailThread,
      last: GmailMessage,
      reason: string,
      counterparts: Participant[],
    ): UnansweredItem | null => {
      if (!last.date) return null;
      return {
        threadId: t.id,
        subject: t.subject,
        sourceUrl: t.sourceUrl,
        lastMessage: { id: last.id, from: last.from, date: last.date, snippet: last.snippet },
        counterparts,
        daysSince: Math.floor((now - Date.parse(last.date)) / DAY_MS),
        reason,
      };
    };

    for (const id of inbox.ids) {
      const t = byId.get(id);
      if (!t) continue;
      const msgs = t.messages.filter((m) => !m.labelIds.includes("DRAFT"));
      const last = msgs[msgs.length - 1];
      if (!last || last.fromUser || last.automated) continue;
      if (!msgs.some((m) => m.labelIds.includes("INBOX"))) continue;
      if (last.labelIds.some((l) => BLOCKED_CATEGORIES.includes(l))) continue;
      if (!last.to.some((p) => p.email === account)) continue; // only Cc'd or Bcc'd, not a direct ask

      const who = last.from?.name ?? last.from?.email ?? "someone";
      const item = toItem(
        t,
        last,
        `Latest message is from ${who} (${last.date?.slice(0, 10)}), you are a direct recipient, and you have not replied since.`,
        last.from ? [last.from] : [],
      );
      if (item) needsReply.push(item);
    }

    for (const id of sent.ids) {
      const t = byId.get(id);
      if (!t) continue;
      const msgs = t.messages.filter((m) => !m.labelIds.includes("DRAFT"));
      const last = msgs[msgs.length - 1];
      if (!last || !last.fromUser || !last.date) continue;
      if (now - Date.parse(last.date) < waitingDays * DAY_MS) continue;

      const recipients = [...last.to, ...last.cc].filter((p) => p.email !== account);
      if (recipients.length === 0) continue;
      if (recipients.every((p) => AUTOMATED_SENDER.test(p.email))) continue;

      const names = recipients.map((p) => p.name ?? p.email).join(", ");
      const item = toItem(
        t,
        last,
        `You sent the latest message to ${names} on ${last.date.slice(0, 10)} and there has been no reply for at least ${waitingDays} days.`,
        recipients,
      );
      if (item) waitingOn.push(item);
    }

    const mostOverdueFirst = (a: UnansweredItem, b: UnansweredItem) => b.daysSince - a.daysSince;
    needsReply.sort(mostOverdueFirst);
    waitingOn.sort(mostOverdueFirst);

    return {
      criteria: { sinceDays, waitingDays },
      scanned: { inboxThreads: inbox.ids.length, sentThreads: sent.ids.length },
      needsReply,
      waitingOn,
    };
  });
}