"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api-client";

interface AgentPrompt {
  name: string;
  responsibility: string;
  defaultPrompt: string;
  currentPrompt: string;
  isOverridden: boolean;
}

/**
 * Every agent's actual prompt text, editable per org. Each row's textarea is
 * only ever saved verbatim — no server-side templating is applied to a saved
 * override, by design (see shared/prompts.py on the AI workers side): typing
 * something here can never crash an agent over a mistyped placeholder, it can
 * only change what the model is told.
 *
 * Collapsed by default. Sixteen full prompts open at once would make this
 * section unusable — a company name and a text area per row keeps the list
 * scannable, and expanding one is a click away.
 */
export function AgentPromptsSection() {
  const [agents, setAgents] = useState<AgentPrompt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openName, setOpenName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyName, setBusyName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function refresh() {
    api
      .getAgentPrompts()
      .then((res) => setAgents(res as AgentPrompt[]))
      .catch((err) => setError((err as Error).message));
  }

  useEffect(refresh, []);

  function toggle(agent: AgentPrompt) {
    if (openName === agent.name) {
      setOpenName(null);
      return;
    }
    setOpenName(agent.name);
    setDraft(agent.currentPrompt);
    setNotice(null);
    setError(null);
  }

  async function save(name: string) {
    setBusyName(name);
    setError(null);
    setNotice(null);
    try {
      const updated = (await api.updateAgentPrompt(name, draft)) as AgentPrompt[];
      setAgents(updated);
      setNotice(`Saved. ${labelFor(name)} now uses this prompt.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyName(null);
    }
  }

  async function restoreDefault(agent: AgentPrompt) {
    setBusyName(agent.name);
    setError(null);
    setNotice(null);
    try {
      const updated = (await api.restoreAgentPrompt(agent.name)) as AgentPrompt[];
      setAgents(updated);
      const restored = updated.find((a) => a.name === agent.name);
      if (restored) setDraft(restored.currentPrompt);
      setNotice(`Restored ${labelFor(agent.name)} to the shipped default.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyName(null);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--line)] p-5">
      <h2 className="mb-1 text-sm font-semibold tracking-tight">Agent prompts</h2>
      <p className="mb-4 text-xs text-ink/50">
        The actual instructions sent to the model for each agent. Edit and save to change how an
        agent behaves org-wide; &ldquo;Default&rdquo; restores exactly what was shipped, discarding
        your edit. The per-candidate/per-lead data (company name, research findings, and so on) is
        always appended automatically — it is never part of what you edit here.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3 rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">
          {notice}
        </div>
      )}

      {!agents ? (
        <p className="py-6 text-center text-sm text-ink/50">Loading…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {agents.map((agent) => {
            const open = openName === agent.name;
            const busy = busyName === agent.name;
            return (
              <div key={agent.name} className="rounded-lg border border-[var(--line)]">
                <button
                  type="button"
                  onClick={() => toggle(agent)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink/85">{labelFor(agent.name)}</span>
                      {agent.isOverridden && (
                        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                          customised
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink/50">{agent.responsibility}</span>
                  </span>
                  <span className="shrink-0 text-xs text-ink/40">{open ? "Hide" : "Edit"}</span>
                </button>

                {open && (
                  <div className="border-t border-[var(--line)] p-3">
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      rows={14}
                      spellCheck={false}
                      className="w-full rounded border border-[var(--line)] bg-transparent p-2.5 font-mono text-xs leading-relaxed"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busy || draft === agent.currentPrompt}
                        onClick={() => save(agent.name)}
                        className="rounded-md bg-accent px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {busy ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        disabled={busy || !agent.isOverridden}
                        onClick={() => restoreDefault(agent)}
                        title={
                          agent.isOverridden
                            ? "Discard your edit and restore the shipped default"
                            : "Already running the shipped default"
                        }
                        className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                      >
                        Default
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const OVERRIDE_LABELS: Record<string, string> = {
  email_step_1: "Email 1 — Problem Trigger",
  email_step_2: "Email 2 — Industry Insight",
  email_step_3: "Email 3 — Proof",
  email_step_4: "Email 4 — Soft Offer",
  email_step_5: "Email 5 — Breakup",
  email_voice_rules: "Email voice & style rules",
};

function labelFor(name: string): string {
  return OVERRIDE_LABELS[name] ?? name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
