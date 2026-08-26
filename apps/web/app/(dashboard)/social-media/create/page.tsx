"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { Spinner } from "../../../../components/spinner";

interface Account {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
  connected: boolean;
  defaultHashtags: string[];
}

interface MediaAsset {
  id: string;
  filename: string;
  mimeType: string;
  url: string;
}

interface HashtagGroup {
  id: string;
  name: string;
  hashtags: string[];
}

interface ContentTemplate {
  id: string;
  name: string;
  category: string;
  bodyTemplate: string;
}

interface Version {
  content: string;
  hashtags: string[];
}

/**
 * The composer (Part: Create Post). Each targeted account gets its own
 * editable content/hashtags — selecting three accounts never means writing
 * one paragraph and blasting it everywhere, per the spec's explicit "never
 * blindly duplicate content" requirement. "Generate with AI" calls the same
 * brief through SocialContentAgent once per platform, so the output is
 * already platform-appropriate rather than a shared draft copy-pasted three
 * times.
 */
export default function CreatePostPage() {
  const router = useRouter();
  // Same query key as /social-media/accounts -- shares the cache entry.
  const accountsQuery = useQuery({
    queryKey: ["social-media-accounts"],
    queryFn: () => api.getSocialAccounts() as Promise<Account[]>,
  });
  const mediaQuery = useQuery({
    queryKey: ["social-media-library"],
    queryFn: () => api.getSocialMedia() as Promise<MediaAsset[]>,
  });
  const hashtagGroupsQuery = useQuery({
    queryKey: ["social-media-hashtag-groups"],
    queryFn: () => api.getSocialHashtagGroups() as Promise<HashtagGroup[]>,
  });
  const templatesQuery = useQuery({
    queryKey: ["social-media-templates"],
    queryFn: () => api.getSocialTemplates() as Promise<ContentTemplate[]>,
  });
  const accounts = accountsQuery.data ?? [];
  const media = mediaQuery.data ?? [];
  const hashtagGroups = hashtagGroupsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];
  const loadError = [accountsQuery.error, mediaQuery.error, hashtagGroupsQuery.error, templatesQuery.error].find(Boolean);
  const isFetchingReference =
    accountsQuery.isFetching || mediaQuery.isFetching || hashtagGroupsQuery.isFetching || templatesQuery.isFetching;
  const isLoadingReference =
    accountsQuery.isLoading || mediaQuery.isLoading || hashtagGroupsQuery.isLoading || templatesQuery.isLoading;
  const [selected, setSelected] = useState<string[]>([]);
  const [versions, setVersions] = useState<Record<string, Version>>({});
  const [mediaAssetIds, setMediaAssetIds] = useState<string[]>([]);
  const [brief, setBrief] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [recurrenceOn, setRecurrenceOn] = useState(false);
  const [frequency, setFrequency] = useState<"DAILY" | "WEEKLY" | "MONTHLY">("WEEKLY");
  const [endDate, setEndDate] = useState("");
  const [generating, setGenerating] = useState<string | null>(null);
  const [saving, setSaving] = useState<"DRAFT" | "PENDING_REVIEW" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleAccount(account: Account) {
    setSelected((prev) => {
      if (prev.includes(account.id)) {
        const next = prev.filter((id) => id !== account.id);
        setVersions((v) => {
          const { [account.id]: _drop, ...rest } = v;
          return rest;
        });
        return next;
      }
      setVersions((v) => ({ ...v, [account.id]: v[account.id] ?? { content: "", hashtags: account.defaultHashtags } }));
      return [...prev, account.id];
    });
  }

  function setVersion(accountId: string, patch: Partial<Version>) {
    setVersions((v) => ({ ...v, [accountId]: { ...v[accountId], ...patch } }));
  }

  function toggleMedia(id: string) {
    setMediaAssetIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  function applyTemplate(accountId: string, template: ContentTemplate) {
    setVersion(accountId, { content: template.bodyTemplate });
  }

  function applyHashtagGroup(accountId: string, group: HashtagGroup) {
    setVersion(accountId, { hashtags: [...new Set([...(versions[accountId]?.hashtags ?? []), ...group.hashtags])] });
  }

  async function generate(account: Account) {
    if (!brief.trim()) {
      setError("Write a brief first — the AI needs something to work from.");
      return;
    }
    setGenerating(account.id);
    setError(null);
    try {
      const result = (await api.generateSocialContent({
        mode: "generate",
        platform: account.platform,
        brief,
        accountId: account.id,
      })) as Version;
      setVersion(account.id, { content: result.content, hashtags: result.hashtags });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(null);
    }
  }

  async function save(status: "DRAFT" | "PENDING_REVIEW") {
    if (selected.length === 0) {
      setError("Select at least one account.");
      return;
    }
    if (selected.some((id) => !versions[id]?.content.trim())) {
      setError("Every selected account needs content before saving.");
      return;
    }
    setSaving(status);
    setError(null);
    try {
      await api.createSocialPost({
        versions: selected.map((id) => ({ accountId: id, content: versions[id].content, hashtags: versions[id].hashtags })),
        mediaAssetIds,
        scheduledAt: scheduledAt || undefined,
        recurrenceRule: recurrenceOn && scheduledAt ? { frequency, endDate: endDate || undefined } : undefined,
        status,
      });
      router.push("/social-media/calendar");
    } catch (err) {
      setError((err as Error).message);
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Create Post</h1>
          {isFetchingReference && !isLoadingReference && <Spinner className="h-3.5 w-3.5" />}
        </div>
        <p className="mt-0.5 text-xs text-ink/50">
          Pick accounts, write or generate content per platform, attach media, and schedule.
        </p>
      </div>

      {(error || loadError) && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error ?? (loadError as Error).message}
        </div>
      )}

      <SectionCard title="1. Target accounts">
        <div className="flex flex-wrap gap-2">
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => toggleAccount(a)}
              className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                selected.includes(a.id) ? "border-accent bg-accent text-white" : "border-[var(--line)] text-ink/70 hover:bg-ink/5"
              }`}
            >
              {a.platform} — {a.displayName || a.username}
              {!a.connected && <span className="ml-1 opacity-60">(not connected)</span>}
            </button>
          ))}
          {accounts.length === 0 && <p className="text-sm text-ink/50">No accounts yet — add one on the Accounts page.</p>}
        </div>
      </SectionCard>

      <SectionCard title="2. Brief (for AI generation)" subtitle="Optional if you're writing every version by hand.">
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={2}
          placeholder="e.g. Announce our new case study with a logistics client that cut response time in half."
          className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
        />
      </SectionCard>

      {selected.length > 0 && (
        <SectionCard title="3. Content per platform" subtitle="Independently editable — nothing here is shared across accounts.">
          <div className="flex flex-col gap-4">
            {selected.map((id) => {
              const account = accounts.find((a) => a.id === id)!;
              const version = versions[id] ?? { content: "", hashtags: [] };
              return (
                <div key={id} className="rounded-lg border border-[var(--line)] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-ink/55">
                      {account.platform} — {account.displayName || account.username}
                    </span>
                    <button
                      type="button"
                      disabled={generating === id}
                      onClick={() => generate(account)}
                      className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                    >
                      {generating === id ? "Generating…" : "Generate with AI"}
                    </button>
                  </div>
                  <textarea
                    value={version.content}
                    onChange={(e) => setVersion(id, { content: e.target.value })}
                    rows={4}
                    placeholder="Write this platform's post…"
                    className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                  />
                  <input
                    value={version.hashtags.join(" ")}
                    onChange={(e) => setVersion(id, { hashtags: e.target.value.split(/\s+/).filter(Boolean) })}
                    placeholder="#hashtags #space-separated"
                    className="mt-2 w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                  />
                  {(templates.length > 0 || hashtagGroups.length > 0) && (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => applyTemplate(id, t)}
                          className="rounded border border-[var(--line)] px-2 py-0.5 text-ink/60 hover:bg-ink/5"
                        >
                          Template: {t.name}
                        </button>
                      ))}
                      {hashtagGroups.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => applyHashtagGroup(id, g)}
                          className="rounded border border-[var(--line)] px-2 py-0.5 text-ink/60 hover:bg-ink/5"
                        >
                          Hashtags: {g.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      <SectionCard title="4. Media" subtitle="Reused from the Media Library — upload more there.">
        <div className="flex flex-wrap gap-2">
          {media.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => toggleMedia(m.id)}
              className={`overflow-hidden rounded-lg border text-left ${mediaAssetIds.includes(m.id) ? "border-accent ring-2 ring-accent/40" : "border-[var(--line)]"}`}
            >
              {m.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.filename} className="h-20 w-20 object-cover" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center bg-ink/5 text-[10px] text-ink/50">{m.filename}</div>
              )}
            </button>
          ))}
          {media.length === 0 && <p className="text-sm text-ink/50">No media uploaded yet.</p>}
        </div>
      </SectionCard>

      <SectionCard title="5. Schedule">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Publish at (leave blank to save as draft only)</span>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={recurrenceOn} onChange={(e) => setRecurrenceOn(e.target.checked)} disabled={!scheduledAt} />
            Repeat
          </label>
          {recurrenceOn && (
            <>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as typeof frequency)}
                className="rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
              >
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </select>
              <label className="block">
                <span className="mb-1 block text-xs text-ink/60">Until</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
                />
              </label>
            </>
          )}
        </div>
      </SectionCard>

      <div className="flex gap-3">
        <button
          type="button"
          disabled={saving !== null}
          onClick={() => save("DRAFT")}
          className="rounded-md border border-[var(--line)] px-4 py-2 text-sm text-ink/70 disabled:opacity-50"
        >
          {saving === "DRAFT" ? "Saving…" : "Save as draft"}
        </button>
        <button
          type="button"
          disabled={saving !== null}
          onClick={() => save("PENDING_REVIEW")}
          className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {saving === "PENDING_REVIEW" ? "Submitting…" : "Submit for review"}
        </button>
      </div>
    </div>
  );
}
