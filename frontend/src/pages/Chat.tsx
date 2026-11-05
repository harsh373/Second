import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Brain, Check, MessageSquare, Plus, RotateCcw, Send, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  conversationKey,
  conversationQueryOptions,
  conversationsQueryOptions,
  createConversation,
  deleteConversation,
  streamReply,
  type ChatMessage,
  type ConversationDetail,
  type SavedMemoryNote,
  type ToolCallView,
} from "../api/conversations.api";
import { deleteMemory } from "../api/memories.api";
import { meQueryOptions } from "../api/user.api";
import { toast } from "../components/ui/Toast";
import { cn } from "../utility/cn";

// Second can read Gmail and Calendar (read-only) and remembers what you tell it.
const SUGGESTIONS = [
  "What emails am I waiting on?",
  "What do I need to reply to?",
  "What's on my calendar tomorrow?",
  "When am I free for 1 hour this week?",
  "What do you remember about me?",
];

interface StreamState {
  conversationId: string;
  text: string;
  status: "streaming" | "error";
  error?: string;
  tools: ToolCallView[];
}

// Makes plain-text URLs clickable. split() with a capture group puts the URLs at odd positions.
const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) => {
        if (i % 2 === 0) return part;
        const trailing = /[.,;:!?]+$/.exec(part)?.[0] ?? "";
        const url = trailing ? part.slice(0, -trailing.length) : part;
        return (
          <span key={i}>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all underline underline-offset-2 hover:opacity-80"
            >
              {url}
            </a>
            {trailing}
          </span>
        );
      })}
    </>
  );
}

function Bubble({ role, children }: { role: "user" | "assistant"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap",
        role === "user"
          ? "ml-auto rounded-br-md bg-accent text-white"
          : "rounded-bl-md border border-line bg-paper text-ink",
      )}
    >
      {children}
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="flex gap-1 py-1.5" role="status" aria-label="Second is thinking">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-ink-muted"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

function ToolCards({ tools }: { tools: ToolCallView[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="max-w-[85%] space-y-1.5">
      {tools.map((t) => (
        <div
          key={t.callId}
          className={cn(
            "rounded-xl border px-3 py-2 text-xs",
            t.status === "error" ? "border-danger/30 bg-danger-soft text-danger" : "border-line bg-paper-dark text-ink-muted",
          )}
        >
          <div className="flex items-center gap-2">
            {t.status === "running" ? (
              <span
                className="size-3 shrink-0 animate-spin rounded-full border-2 border-ink-muted border-t-transparent"
                aria-hidden
              />
            ) : t.status === "done" ? (
              <Check className="size-3.5 shrink-0 text-success" aria-hidden />
            ) : (
              <X className="size-3.5 shrink-0" aria-hidden />
            )}
            <span className={cn("min-w-0 flex-1 font-medium", t.status !== "error" && "text-ink")}>{t.label}</span>
            <code className="shrink-0 text-[10px] opacity-70">{t.name}</code>
          </div>
          {t.summary && <p className="mt-1 pl-5">{t.summary}</p>}
          {t.links.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-x-3 pl-5">
              {t.links.map((url, i) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Source {i + 1}
                </a>
              ))}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function MemoryNotes({ notes, onUndo }: { notes: SavedMemoryNote[]; onUndo: (note: SavedMemoryNote) => void }) {
  if (notes.length === 0) return null;
  return (
    <div className="max-w-[85%] space-y-1">
      {notes.map((n) => (
        <div key={n.id} className="flex items-start gap-2 text-xs text-ink-muted">
          <Brain className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1 break-words">
            {n.action === "updated" ? "Updated memory: " : "Remembered: "}
            {n.content}
          </span>
          {n.action === "created" ? (
            <button
              type="button"
              onClick={() => onUndo(n)}
              className="shrink-0 cursor-pointer font-medium text-accent hover:underline"
            >
              Undo
            </button>
          ) : (
            <Link to="/app/memory" className="shrink-0 font-medium text-accent hover:underline">
              View
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

export default function Chat() {
  const { conversationId } = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { getToken } = useAuth();

  const [stream, setStream] = useState<StreamState | null>(null);
  const [toolsByMessage, setToolsByMessage] = useState<Record<string, ToolCallView[]>>({});
  const [notesByMessage, setNotesByMessage] = useState<Record<string, SavedMemoryNote[]>>({});
  const [draft, setDraft] = useState("");
  const [showList, setShowList] = useState(false); // mobile only: list vs chat
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);

  const me = useQuery(meQueryOptions);
  const list = useQuery(conversationsQueryOptions);
  const detail = useQuery({ ...conversationQueryOptions(conversationId ?? ""), enabled: Boolean(conversationId) });

  const messages: ChatMessage[] = detail.data?.messages ?? [];
  const lastMessage = messages[messages.length - 1];
  const isStreaming = stream?.status === "streaming";
  const activeStream = stream && stream.conversationId === conversationId ? stream : null;
  const streamingHere = activeStream?.status === "streaming";
  const needsRetry = Boolean(conversationId) && !detail.isLoading && lastMessage?.role === "user" && !streamingHere;
  const showBanner = needsRetry || activeStream?.status === "error";
  const isEmpty = !conversationId || (detail.isSuccess && messages.length === 0 && !activeStream);
  const firstName = me.data?.user.fullName?.trim().split(/\s+/)[0];
  const toolRunning = Boolean(activeStream?.tools.some((t) => t.status === "running"));

  // Abort an in-flight reply if the user leaves this page. The server discards the partial text.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    stickRef.current = true;
  }, [conversationId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [
    messages.length,
    activeStream?.text,
    activeStream?.status,
    activeStream?.tools,
    notesByMessage,
    conversationId,
    detail.isSuccess,
  ]);

  // Grow the textarea with its content, up to a limit.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  function appendMessage(id: string, message: ChatMessage) {
    qc.setQueryData<ConversationDetail>(conversationKey(id), (old) =>
      old ? { ...old, messages: [...old.messages, message] } : old,
    );
  }

  async function run(id: string, content: string | undefined) {
    const controller = new AbortController();
    abortRef.current = controller;
    stickRef.current = true;
    let tools: ToolCallView[] = [];
    let savedId: string | null = null;
    setStream({ conversationId: id, text: "", status: "streaming", tools });

    try {
      const token = await getToken();
      if (!token) throw new ApiError(401, "You are signed out. Please sign in again.", "UNAUTHENTICATED");

      await streamReply({
        conversationId: id,
        content,
        token,
        signal: controller.signal,
        onToken: (text) =>
          setStream((s) => (s && s.status === "streaming" ? { ...s, text: s.text + text } : s)),
        // Text written before a tool call is discarded (the server does the same).
        onToolStart: (t) => {
          tools = [...tools, { ...t, status: "running", links: [] }];
          setStream((s) => (s && s.status === "streaming" ? { ...s, text: "", tools } : s));
        },
        onToolResult: (r) => {
          tools = tools.map((t) =>
            t.callId === r.callId
              ? { ...t, status: r.ok ? "done" : "error", summary: r.summary, links: r.links }
              : t,
          );
          setStream((s) => (s && s.status === "streaming" ? { ...s, tools } : s));
        },
        // The reply is complete: show it and free the composer right away.
        onDone: (saved) => {
          savedId = saved.id;
          appendMessage(id, saved);
          if (tools.length > 0) setToolsByMessage((prev) => ({ ...prev, [saved.id]: tools }));
          setStream(null);
          void qc.invalidateQueries({ queryKey: conversationKey(id) }); // picks up the real ids and title
        },
        // Arrives a moment after onDone, only when Second saved something.
        onMemory: (notes) => {
          const key = savedId;
          if (!key) return;
          setNotesByMessage((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), ...notes] }));
          void qc.invalidateQueries({ queryKey: ["memories"] });
        },
      });
    } catch (err) {
      if (controller.signal.aborted) {
        setStream(null);
      } else {
        setStream({
          conversationId: id,
          text: "",
          status: "error",
          error: err instanceof Error ? err.message : "Something went wrong.",
          tools,
        });
      }
    } finally {
      // Only clear the ref if a newer reply has not already replaced it.
      if (abortRef.current === controller) abortRef.current = null;
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    }
  }

  async function send(raw: string) {
    const content = raw.trim();
    if (!content || isStreaming) return;
    setDraft("");

    let id = conversationId;
    if (!id) {
      try {
        const { conversation } = await createConversation();
        id = conversation.id;
        qc.setQueryData<ConversationDetail>(conversationKey(id), { conversation, messages: [] });
        navigate(`/app/chat/${id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not start a conversation.");
        setDraft(content);
        return;
      }
    }

    appendMessage(id, {
      id: `tmp-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    });
    void run(id, content);
  }

  function retry() {
    if (conversationId && !isStreaming) void run(conversationId, undefined);
  }

  async function undoMemory(messageId: string, note: SavedMemoryNote) {
    try {
      await deleteMemory(note.id);
      setNotesByMessage((prev) => ({
        ...prev,
        [messageId]: (prev[messageId] ?? []).filter((n) => n.id !== note.id),
      }));
      void qc.invalidateQueries({ queryKey: ["memories"] });
      toast.success("Memory removed.");
    } catch {
      toast.error("Could not remove that memory.");
    }
  }

  const remove = useMutation({
    mutationFn: deleteConversation,
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: conversationKey(id) });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      if (id === conversationId) navigate("/app/chat");
    },
    onError: () => toast.error("Could not delete the conversation."),
  });

  function confirmDelete(id: string) {
    if (!window.confirm("Delete this conversation? This cannot be undone.")) return;
    if (stream?.conversationId === id) abortRef.current?.abort();
    remove.mutate(id);
  }

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-96 gap-4">
      {/* Conversation list */}
      <aside
        className={cn(
          "w-full shrink-0 flex-col rounded-2xl border border-line bg-surface md:flex md:w-64",
          showList ? "flex" : "hidden",
        )}
      >
        <div className="p-3">
          <Link
            to="/app/chat"
            onClick={() => setShowList(false)}
            className="flex items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper-dark"
          >
            <Plus className="size-4" aria-hidden />
            New chat
          </Link>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2" aria-label="Conversations">
          {list.isLoading && <p className="px-3 py-2 text-sm text-ink-muted">Loading…</p>}
          {list.isError && <p className="px-3 py-2 text-sm text-danger">Could not load conversations.</p>}
          {list.data?.conversations.length === 0 && (
            <p className="px-3 py-2 text-sm text-ink-muted">No conversations yet.</p>
          )}
          {list.data?.conversations.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center rounded-lg transition-colors",
                c.id === conversationId ? "bg-accent-soft" : "hover:bg-paper-dark",
              )}
            >
              <Link
                to={`/app/chat/${c.id}`}
                onClick={() => setShowList(false)}
                className={cn(
                  "min-w-0 flex-1 truncate px-3 py-2 text-sm",
                  c.id === conversationId ? "font-medium text-accent" : "text-ink",
                )}
              >
                {c.title}
              </Link>
              <button
                type="button"
                onClick={() => confirmDelete(c.id)}
                aria-label={`Delete ${c.title}`}
                className="mr-1 cursor-pointer rounded-md p-1.5 text-ink-muted opacity-100 hover:text-danger md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </div>
          ))}
        </nav>
      </aside>

      {/* Chat panel */}
      <section
        className={cn(
          "min-w-0 flex-1 flex-col rounded-2xl border border-line bg-surface md:flex",
          showList ? "hidden" : "flex",
        )}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <button
            type="button"
            onClick={() => setShowList(true)}
            aria-label="Show conversations"
            className="cursor-pointer rounded-lg p-1.5 text-ink-muted hover:bg-paper-dark md:hidden"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>
          <h1 className="truncate text-sm font-medium">
            {conversationId ? (detail.data?.conversation.title ?? "Conversation") : "New conversation"}
          </h1>
        </div>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
          }}
          className="flex-1 space-y-4 overflow-y-auto px-4 py-5"
        >
          {conversationId && detail.isLoading && <p className="text-sm text-ink-muted">Loading conversation…</p>}

          {conversationId && detail.isError && (
            <div className="space-y-2 text-sm">
              <p className="text-danger">
                {detail.error instanceof ApiError && detail.error.status === 404
                  ? "This conversation does not exist."
                  : "Could not load this conversation."}
              </p>
              <Link to="/app/chat" className="font-medium text-accent hover:underline">
                Start a new chat
              </Link>
            </div>
          )}

          {isEmpty && !detail.isError && (
            <div className="mx-auto flex max-w-md flex-col items-center gap-5 pt-10 text-center">
              <MessageSquare className="size-8 text-accent" aria-hidden />
              <div className="space-y-2">
                <h2 className="font-display text-3xl">{firstName ? `What's on your mind, ${firstName}?` : "What's on your mind?"}</h2>
                <p className="text-sm text-ink-muted">
                  I can read your Gmail and calendar once Google is connected in Settings, and I remember lasting facts
                  you tell me (see Memory). I can&apos;t send or change anything.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={isStreaming}
                    onClick={() => void send(s)}
                    className="cursor-pointer rounded-full border border-line px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-paper-dark disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            const used = toolsByMessage[m.id];
            const notes = notesByMessage[m.id];
            return (
              <div key={m.id} className="space-y-2">
                {used && <ToolCards tools={used} />}
                <Bubble role={m.role}>
                  <Linkified text={m.content} />
                </Bubble>
                {notes && notes.length > 0 && <MemoryNotes notes={notes} onUndo={(n) => void undoMemory(m.id, n)} />}
              </div>
            );
          })}

          {streamingHere && (
            <div className="space-y-2">
              <ToolCards tools={activeStream.tools} />
              {(activeStream.text || !toolRunning) && (
                <Bubble role="assistant">
                  {activeStream.text ? <Linkified text={activeStream.text} /> : <ThinkingDots />}
                </Bubble>
              )}
            </div>
          )}

          {activeStream?.status === "error" && activeStream.tools.length > 0 && <ToolCards tools={activeStream.tools} />}

          {showBanner && (
            <div className="flex items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
              <span className="flex-1">
                {activeStream?.status === "error" && activeStream.error
                  ? activeStream.error
                  : "This message has no reply yet."}
              </span>
              {needsRetry && (
                <button
                  type="button"
                  onClick={retry}
                  disabled={isStreaming}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-surface px-3 py-1.5 font-medium text-ink hover:bg-paper-dark disabled:opacity-50"
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  Retry
                </button>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-line p-3">
          <div className="flex items-end gap-2 rounded-2xl border border-line bg-paper px-3 py-2 focus-within:border-accent">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              rows={1}
              maxLength={8000}
              placeholder="Message Second"
              className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-ink-muted"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop"
                className="cursor-pointer rounded-lg bg-ink p-2 text-white hover:opacity-90"
              >
                <Square className="size-4" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void send(draft)}
                disabled={!draft.trim()}
                aria-label="Send"
                className="cursor-pointer rounded-lg bg-accent p-2 text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Send className="size-4" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}