"use client";

import { useEffect, useState } from "react";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";

interface ContentTemplate {
  id: string;
  name: string;
  category: string;
  bodyTemplate: string;
}

interface HashtagGroup {
  id: string;
  name: string;
  hashtags: string[];
}

const EMPTY_TEMPLATE = { name: "", category: "", bodyTemplate: "" };
const EMPTY_GROUP = { name: "", hashtags: "" };

/** Reusable starting points for the composer (Part: Content Templates / Hashtag groups). */
export default function TemplatesPage() {
  const [templates, setTemplates] = useState<ContentTemplate[]>([]);
  const [groups, setGroups] = useState<HashtagGroup[]>([]);
  const [templateDraft, setTemplateDraft] = useState(EMPTY_TEMPLATE);
  const [groupDraft, setGroupDraft] = useState(EMPTY_GROUP);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api.getSocialTemplates().then((r) => setTemplates(r as ContentTemplate[])).catch((err) => setError((err as Error).message));
    api.getSocialHashtagGroups().then((r) => setGroups(r as HashtagGroup[])).catch((err) => setError((err as Error).message));
  }

  useEffect(refresh, []);

  async function addTemplate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createSocialTemplate(templateDraft);
      setTemplateDraft(EMPTY_TEMPLATE);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deleteTemplate(id: string) {
    try {
      await api.deleteSocialTemplate(id);
      setTemplates((t) => t.filter((x) => x.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function addGroup(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createSocialHashtagGroup({ name: groupDraft.name, hashtags: groupDraft.hashtags.split(/\s+/).filter(Boolean) });
      setGroupDraft(EMPTY_GROUP);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deleteGroup(id: string) {
    try {
      await api.deleteSocialHashtagGroup(id);
      setGroups((g) => g.filter((x) => x.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Templates</h1>
        <p className="mt-0.5 text-xs text-ink/50">Content templates and hashtag groups, available from the composer.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}

      <SectionCard title="Content templates">
        <form onSubmit={addTemplate} className="mb-4 flex flex-col gap-2 border-b border-[var(--line)] pb-4 sm:flex-row sm:items-end">
          <input
            required
            value={templateDraft.name}
            onChange={(e) => setTemplateDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Name (e.g. Product Announcement)"
            className="rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          />
          <input
            required
            value={templateDraft.category}
            onChange={(e) => setTemplateDraft((d) => ({ ...d, category: e.target.value }))}
            placeholder="Category"
            className="rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          />
          <input
            required
            value={templateDraft.bodyTemplate}
            onChange={(e) => setTemplateDraft((d) => ({ ...d, bodyTemplate: e.target.value }))}
            placeholder="Body text with {{placeholders}}"
            className="flex-1 rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm text-white">
            Add
          </button>
        </form>
        <div className="flex flex-col gap-2">
          {templates.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-3 rounded-lg border border-[var(--line)] p-3">
              <div>
                <div className="text-sm font-medium">{t.name} <span className="text-xs text-ink/45">— {t.category}</span></div>
                <div className="mt-0.5 text-xs text-ink/55">{t.bodyTemplate}</div>
              </div>
              <button onClick={() => deleteTemplate(t.id)} className="shrink-0 text-xs text-bad hover:underline">
                Delete
              </button>
            </div>
          ))}
          {templates.length === 0 && <p className="py-4 text-center text-sm text-ink/50">No templates yet.</p>}
        </div>
      </SectionCard>

      <SectionCard title="Hashtag groups">
        <form onSubmit={addGroup} className="mb-4 flex flex-col gap-2 border-b border-[var(--line)] pb-4 sm:flex-row sm:items-end">
          <input
            required
            value={groupDraft.name}
            onChange={(e) => setGroupDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Name"
            className="rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          />
          <input
            required
            value={groupDraft.hashtags}
            onChange={(e) => setGroupDraft((d) => ({ ...d, hashtags: e.target.value }))}
            placeholder="#hashtags #space-separated"
            className="flex-1 rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm text-white">
            Add
          </button>
        </form>
        <div className="flex flex-col gap-2">
          {groups.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] p-3">
              <div>
                <div className="text-sm font-medium">{g.name}</div>
                <div className="mt-0.5 text-xs text-ink/55">{g.hashtags.join(" ")}</div>
              </div>
              <button onClick={() => deleteGroup(g.id)} className="shrink-0 text-xs text-bad hover:underline">
                Delete
              </button>
            </div>
          ))}
          {groups.length === 0 && <p className="py-4 text-center text-sm text-ink/50">No hashtag groups yet.</p>}
        </div>
      </SectionCard>
    </div>
  );
}
