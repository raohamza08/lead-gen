"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Modal } from "./ui/modal";
import { Spinner } from "./spinner";
import { api } from "../lib/api-client";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M20.5 3.5 10.5 13.5M20.5 3.5 14 20.5l-3.5-7-7-3.5z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Real AI chat assistant (Part: EBOS-inspired shell redesign round 2,
 * 2026-10-21, explicit user request — wire the previously-decorative header
 * "AI" button up to something real). Bubble list + pill composer follow the
 * same visual convention as social-media/conversation-detail-panel.tsx's
 * reply thread. Stateless server-side (see AssistantService's own docblock)
 * — this component's `messages` state IS the only copy of the conversation;
 * it's lost on refresh/close by design, not a bug.
 */
export function AiAssistantPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sendMutation = useMutation({
    mutationFn: (text: string) => api.sendAssistantMessage(text, messages),
    onSuccess: (res) => {
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
      setError(null);
    },
    onError: (err: Error) => setError(err.message || "Couldn't reach the assistant — try again."),
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sendMutation.isPending) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setDraft("");
    sendMutation.mutate(text);
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      variant="drawer-right"
      title="AI Assistant"
      contentClassName="w-full max-w-md"
      bodyClassName="flex flex-1 flex-col overflow-hidden p-0"
    >
      {error && (
        <div className="mx-4 mt-2 rounded border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-1.5 text-xs text-bad">
          {error}
        </div>
      )}

      <div className="flex-1 space-y-2.5 overflow-y-auto bg-ink/[0.012] px-4 py-3">
        {messages.length === 0 && (
          <p className="py-8 text-center text-xs text-ink/40">
            Ask about your own Outly data — e.g. &quot;how many unread emails do I have&quot; or &quot;how many leads came in this week&quot;.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                m.role === "user" ? "bg-accent text-white" : "bg-surface-elevated border border-[var(--line)]"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {sendMutation.isPending && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-[var(--line)] bg-surface-elevated px-3.5 py-2 text-sm text-ink/50 shadow-sm">
              <Spinner className="h-4 w-4" />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-[var(--line)] px-4 py-3">
        <form onSubmit={submit} className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask a question..."
            className="flex-1 rounded-full border-0 bg-ink/[0.05] px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={sendMutation.isPending || !draft.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
          >
            {sendMutation.isPending ? <Spinner className="h-4 w-4" /> : <SendIcon />}
          </button>
        </form>
      </div>
    </Modal>
  );
}
