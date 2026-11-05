import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  addMemory,
  deleteMemory,
  memoriesQueryOptions,
  type MemoryCategory,
  type MemoryItem,
} from "../api/memories.api";
import { toast } from "../components/ui/Toast";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function SourceLine({ memory }: { memory: MemoryItem }): ReactNode {
  const s = memory.source;
  if (!s) return "Source unknown";
  const date = formatDate(s.createdAt ?? memory.createdAt);
  if (s.type === "manual") return `Added by you · ${date}`;
  if (s.conversationId) {
    return (
      <>
        From{" "}
        <Link to={`/app/chat/${s.conversationId}`} className="text-accent underline-offset-2 hover:underline">
          a conversation
        </Link>{" "}
        · {date}
      </>
    );
  }
  return `From a conversation that was deleted · ${date}`;
}

export default function Memory() {
  const qc = useQueryClient();
  const memories = useQuery(memoriesQueryOptions);
  const [category, setCategory] = useState<MemoryCategory>("preferences");
  const [content, setContent] = useState("");

  const add = useMutation({
    mutationFn: addMemory,
    onSuccess: () => {
      setContent("");
      void qc.invalidateQueries({ queryKey: ["memories"] });
      toast.success("Memory added.");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not add that memory."),
  });

  const remove = useMutation({
    mutationFn: deleteMemory,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["memories"] }),
    onError: () => toast.error("Could not delete that memory."),
  });

  function confirmDelete(m: MemoryItem) {
    if (!window.confirm(`Forget this?\n\n${m.content}`)) return;
    remove.mutate(m.id);
  }

  const items = memories.data?.memories ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <h1 className="font-display text-4xl">Memory</h1>
        <p className="text-sm text-ink-muted">
          What Second remembers about you. Everything here comes from something you told it, and you can delete any of
          it. Second never saves anything from your email or calendar.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = content.trim();
          if (text && !add.isPending) add.mutate({ category, content: text });
        }}
        className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 sm:flex-row"
      >
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as MemoryCategory)}
          aria-label="Category"
          className="rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
        >
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={200}
          placeholder="Something Second should remember about you"
          className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm outline-none placeholder:text-ink-muted focus:border-accent"
        />
        <button
          type="submit"
          disabled={!content.trim() || add.isPending}
          className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="size-4" aria-hidden />
          Add
        </button>
      </form>

      {memories.isLoading && <p className="text-sm text-ink-muted">Loading…</p>}
      {memories.isError && <p className="text-sm text-danger">Could not load your memories.</p>}

      {memories.isSuccess && items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted">
          Nothing yet. As you chat, Second saves lasting facts you state about yourself, such as preferences, goals and
          responsibilities, and shows them here.
        </p>
      )}

      {CATEGORY_ORDER.map((cat) => {
        const group = items.filter((m) => m.category === cat);
        if (group.length === 0) return null;
        return (
          <section key={cat} className="space-y-2">
            <h2 className="text-xs font-medium tracking-wide text-ink-muted uppercase">{CATEGORY_LABELS[cat]}</h2>
            <ul className="space-y-2">
              {group.map((m) => (
                <li key={m.id} className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm break-words text-ink">{m.content}</p>
                    <p className="mt-1 text-xs text-ink-muted">
                      <SourceLine memory={m} />
                    </p>
                    {m.source?.excerpt && (
                      <p className="mt-0.5 text-xs break-words text-ink-muted italic">
                        You said: “{m.source.excerpt}”
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => confirmDelete(m)}
                    aria-label="Delete this memory"
                    className="cursor-pointer rounded-md p-1.5 text-ink-muted hover:text-danger"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}