"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getCurrentUser } from "../lib/api-client";

interface Picklists {
  categories: string[];
  submitters: string[];
  profiles: string[];
}

type ListKey = keyof Picklists;

const LIST_LABEL: Record<ListKey, string> = {
  categories: "Job categories",
  submitters: "Submitted by",
  profiles: "Profile names",
};

/** One tag-list editor: existing values as removable chips, plus an add
 *  box. Saves the whole edited list on every change (Part: Upwork
 *  picklists, 2026-09-29) — admin-only, gated by the parent. */
function ListEditor({
  listKey,
  values,
  onSave,
  saving,
}: {
  listKey: ListKey;
  values: string[];
  onSave: (listKey: ListKey, next: string[]) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v || values.some((x) => x.toLowerCase() === v.toLowerCase())) { setDraft(""); return; }
    onSave(listKey, [...values, v]);
    setDraft("");
  }

  function remove(v: string) {
    onSave(listKey, values.filter((x) => x !== v));
  }

  return (
    <div>
      <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink/55">{LIST_LABEL[listKey]}</h4>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {values.length === 0 && <span className="text-xs text-ink/40">No options yet.</span>}
        {values.map((v) => (
          <span key={v} className="flex items-center gap-1 rounded-full bg-ink/8 px-2.5 py-1 text-xs text-ink/75">
            {v}
            <button
              type="button"
              onClick={() => remove(v)}
              disabled={saving}
              aria-label={`Remove ${v}`}
              className="text-ink/40 hover:text-bad"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={`Add ${LIST_LABEL[listKey].toLowerCase()}…`}
          className="w-48 rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={add}
          disabled={saving || !draft.trim()}
          className="rounded border border-[var(--line)] px-2.5 py-1 text-xs hover:bg-ink/5 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

/** Admin-only picklist manager for the Bidding/Invite forms — everyone else
 *  never sees this, they only see the dropdowns it populates. */
export function UpworkPicklistManager() {
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["upwork-picklists"],
    queryFn: () => api.getUpworkPicklists() as Promise<Picklists>,
    enabled: isAdmin,
  });

  if (!isAdmin) return null;

  async function save(listKey: ListKey, next: string[]) {
    setSaving(true);
    setError(null);
    try {
      const updated = (await api.updateUpworkPicklists({ [listKey]: next })) as Picklists;
      // The submission form reads this exact query key too — writing the
      // cache directly means the dropdowns update immediately, no refetch.
      queryClient.setQueryData(["upwork-picklists"], updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-[var(--line)] p-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-ink/70 hover:text-ink"
      >
        {open ? "▾" : "▸"} Manage dropdown options (admin)
      </button>
      {open && (
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {error && <p className="sm:col-span-3 text-xs text-bad">{error}</p>}
          {data ? (
            (["categories", "submitters", "profiles"] as ListKey[]).map((key) => (
              <ListEditor key={key} listKey={key} values={data[key]} onSave={save} saving={saving} />
            ))
          ) : (
            <p className="text-xs text-ink/50">Loading…</p>
          )}
        </div>
      )}
    </div>
  );
}
