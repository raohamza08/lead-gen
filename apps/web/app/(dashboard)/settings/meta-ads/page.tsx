"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { Spinner } from "../../../../components/spinner";
import { EmptyState } from "../../../../components/ui/empty-state";
import type { MetaAdAccountRow } from "../../../../components/meta-ads/account-status-bar";

interface PendingCandidate {
  externalAccountId: string;
  name: string;
  currency?: string;
  timezoneName?: string;
  businessName?: string;
}

function StatusBadge({ status }: { status: MetaAdAccountRow["status"] }) {
  const tone =
    status === "CONNECTED" ? "bg-good/15 text-good" : status === "EXPIRED" || status === "ERROR" ? "bg-bad/15 text-bad" : "bg-ink/8 text-ink/50";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>{status}</span>;
}

/**
 * Connect/manage Meta Ads accounts (Part: Meta Ads module) — deliberately a
 * separate connection from the Social Media module's Facebook page (Part:
 * standing decision: ads_read is a different grant than posting/DM/
 * engagement scopes, and a problem with one connection should never break
 * the other). Mirrors social-media/accounts' picker pattern: OAuth always
 * redirects back here with either a Meta-error or a pending selection.
 */
export default function MetaAdsSettingsPage() {
  const queryClient = useQueryClient();
  const accountsQuery = useQuery({
    queryKey: ["meta-ads-accounts"],
    queryFn: () => api.getMetaAdsAccounts() as Promise<MetaAdAccountRow[]>,
  });
  const accounts = accountsQuery.data ?? [];
  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["meta-ads-accounts"] });
  }

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingCandidates, setPendingCandidates] = useState<PendingCandidate[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [selecting, setSelecting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectError = params.get("meta_ads_error");
    const pending = params.get("meta_ads_pending");
    if (connectError) setError(connectError);
    if (pending) {
      setPendingId(pending);
      api
        .getMetaAdsPendingSelection(pending)
        .then((res) => setPendingCandidates((res as { accounts: PendingCandidate[] }).accounts))
        .catch((err) => setError((err as Error).message));
    }
    if (connectError || pending) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await api.getMetaAdsOAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
      setConnecting(false);
    }
  }

  async function confirmSelection() {
    if (!pendingId) return;
    const externalAccountIds = Object.entries(checked).filter(([, v]) => v).map(([id]) => id);
    if (externalAccountIds.length === 0) {
      setError("Select at least one ad account.");
      return;
    }
    setSelecting(true);
    setError(null);
    try {
      await api.selectMetaAdAccounts(pendingId, externalAccountIds);
      setNotice(`${externalAccountIds.length} ad account(s) connected.`);
      setPendingId(null);
      setPendingCandidates(null);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSelecting(false);
    }
  }

  async function disconnect(account: MetaAdAccountRow) {
    setBusyId(account.id);
    setError(null);
    try {
      await api.disconnectMetaAdAccount(account.id);
      setNotice(`${account.name} disconnected.`);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Meta Ads Settings</h1>
            {accountsQuery.isFetching && !accountsQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
          </div>
          <p className="mt-0.5 text-xs text-ink/50">
            Connect the Meta ad account(s) you want reported in{" "}
            <a href="/dashboards?tab=meta-ads" className="text-accent hover:underline">
              Meta Ads
            </a>
            . Read-only — this never posts or changes anything in your ad account.
          </p>
        </div>
        <button
          type="button"
          disabled={connecting}
          onClick={connect}
          className="rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {connecting ? "Redirecting…" : "Connect Meta Ads account"}
        </button>
      </div>

      {(error || accountsQuery.error) && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error ?? (accountsQuery.error as Error).message}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">
          {notice}
        </div>
      )}

      {pendingId && pendingCandidates && pendingCandidates.length > 0 && (
        <SectionCard title="Choose which ad account(s) to connect">
          <p className="mb-3 text-xs text-ink/55">This login can report on {pendingCandidates.length} ad account(s). Check as many as you need.</p>
          <div className="flex flex-col gap-2">
            {pendingCandidates.map((c) => (
              <label key={c.externalAccountId} className="flex items-center gap-3 rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(checked[c.externalAccountId])}
                  onChange={(e) => setChecked((m) => ({ ...m, [c.externalAccountId]: e.target.checked }))}
                />
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-ink/50">
                    {c.currency ?? "—"} · {c.timezoneName ?? "—"} {c.businessName ? `· ${c.businessName}` : ""}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={selecting}
            onClick={confirmSelection}
            className="mt-3 rounded-md bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            {selecting ? "Connecting…" : "Connect selected"}
          </button>
        </SectionCard>
      )}

      <SectionCard title="Connected accounts">
        {accounts.length === 0 ? (
          <EmptyState
            title="No Meta ad account connected yet"
            description="Click “Connect Meta Ads account” above to authorize with Meta and pick an ad account."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {accounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] px-3 py-2">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {a.name}
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="text-xs text-ink/50">
                    {a.externalAccountId} · {a.currency ?? "—"} {a.businessName ? `· ${a.businessName}` : ""}
                  </div>
                  {a.lastSyncError && <div className="mt-1 text-xs text-bad">{a.lastSyncError}</div>}
                </div>
                <button
                  disabled={busyId === a.id}
                  onClick={() => disconnect(a)}
                  className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                >
                  Disconnect
                </button>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
