"use client";

import { useState } from "react";
import { api } from "../../lib/api-client";
import { Spinner } from "../spinner";

export interface MetaAdAccountRow {
  id: string;
  externalAccountId: string;
  name: string;
  currency: string | null;
  timezoneName: string | null;
  businessName: string | null;
  status: "CONNECTED" | "EXPIRED" | "DISCONNECTED" | "ERROR";
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  tokenExpiresAt: string | null;
}

function StatusBadge({ status }: { status: MetaAdAccountRow["status"] }) {
  const tone =
    status === "CONNECTED" ? "bg-good/15 text-good" : status === "EXPIRED" || status === "ERROR" ? "bg-bad/15 text-bad" : "bg-ink/8 text-ink/50";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>{status}</span>;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Header strip every Meta Ads page shares: which connected account is
 *  active, its status, when it last synced, and a manual refresh — the
 *  "Connected Ad Account / Account status / Last synced time / Refresh
 *  button" row the module spec calls for, factored out once rather than
 *  duplicated across Overview/Campaigns/Ad Sets/Ads. */
export function MetaAdsAccountStatusBar({
  accounts,
  selectedId,
  onSelect,
  onSynced,
}: {
  accounts: MetaAdAccountRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSynced: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = accounts.find((a) => a.id === selectedId);

  async function sync() {
    if (!selectedId) return;
    setSyncing(true);
    setError(null);
    try {
      await api.syncMetaAdAccount(selectedId);
      onSynced();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {accounts.length > 1 ? (
          <select
            value={selectedId ?? ""}
            onChange={(e) => onSelect(e.target.value)}
            className="rounded-md border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm font-medium">{selected?.name}</span>
        )}
        {selected && <StatusBadge status={selected.status} />}
        {selected && <span className="text-xs text-ink/50">Last synced {timeAgo(selected.lastSyncAt)}</span>}
        <button
          type="button"
          disabled={syncing || !selectedId}
          onClick={sync}
          className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
        >
          {syncing ? (
            <span className="flex items-center gap-1.5">
              <Spinner className="h-3 w-3" /> Syncing…
            </span>
          ) : (
            "Sync now"
          )}
        </button>
        <a href="/settings/meta-ads" className="text-xs text-accent hover:underline">
          Manage accounts
        </a>
      </div>
      {selected?.status === "EXPIRED" && (
        <div className="rounded-md bg-bad/10 px-3 py-1.5 text-xs text-bad">
          This account&apos;s connection expired — {selected.lastSyncError ?? "reconnect it in Settings."}
        </div>
      )}
      {selected?.status === "ERROR" && selected.lastSyncError && (
        <div className="rounded-md bg-bad/10 px-3 py-1.5 text-xs text-bad">Last sync failed: {selected.lastSyncError}</div>
      )}
      {error && <div className="rounded-md bg-bad/10 px-3 py-1.5 text-xs text-bad">{error}</div>}
    </div>
  );
}
