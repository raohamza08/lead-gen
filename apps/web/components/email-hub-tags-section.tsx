"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api-client";

interface Tag {
  id: string;
  name: string;
  color: string;
}

/** User-defined tag vocabulary (Part: Email Tags) — the same CRUD the
 *  Unified Inbox page's "Manage tags" panel uses, surfaced here too since a
 *  tag is a setting an admin configures ahead of time, not just something
 *  invented mid-triage. */
export function EmailHubTagsSection() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api.getEmailTags().then((t) => setTags(t as Tag[])).catch((err) => setError((err as Error).message));
  }

  useEffect(refresh, []);

  async function createTag(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      await api.createEmailTag({ name: name.trim() });
      setName("");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deleteTag(id: string) {
    setError(null);
    try {
      await api.deleteEmailTag(id);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--line)] p-5">
      <h2 className="mb-1 text-sm font-semibold tracking-tight">Tags</h2>
      <p className="mb-4 text-xs text-ink/50">
        Your own vocabulary for triaging the unified inbox — create as many as you need, nothing here is
        hardcoded.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}

      <form onSubmit={createTag} className="mb-3 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New tag name"
          className="rounded border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm"
        />
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-xs text-white">
          Add tag
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <span
            key={t.id}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-white"
            style={{ backgroundColor: t.color }}
          >
            {t.name}
            <button onClick={() => deleteTag(t.id)} className="text-white/80 hover:text-white" aria-label={`Delete tag ${t.name}`}>
              ✕
            </button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-xs text-ink/50">No tags yet.</span>}
      </div>
    </section>
  );
}
