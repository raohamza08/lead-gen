"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { Spinner } from "../../../../components/spinner";

interface ConnectionStatus {
  connected: boolean;
  status?: "CONNECTED" | "EXPIRED" | "DISCONNECTED" | "ERROR";
  scope?: string;
  organizationName?: string | null;
  connectedAt?: string;
  tokenExpiresAt?: string;
  lastSyncAt?: string;
  lastSyncError?: string | null;
}

const STUB_MODULES = [
  { label: "Agency & profile management", hint: "Sync agency/freelancer profile details." },
  { label: "Invite tracking", hint: "Track and respond to client invitations." },
  { label: "Bidding & proposal data", hint: "Pull proposal/bid status and win rates." },
  { label: "Connects usage monitoring", hint: "Track Connects balance and spend." },
  { label: "Job discovery", hint: "Surface relevant job postings as they're posted." },
  { label: "Reporting", hint: "Weekly / monthly / yearly financial & performance reports." },
  { label: "Client communication monitoring", hint: "Internal concern-alerting only — no auto-replies." },
];

function StatusBadge({ status }: { status: ConnectionStatus["status"] }) {
  const tone =
    status === "CONNECTED" ? "bg-good/15 text-good" : status === "EXPIRED" || status === "ERROR" ? "bg-bad/15 text-bad" : "bg-ink/8 text-ink/50";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>{status ?? "DISCONNECTED"}</span>;
}

/**
 * Connect/manage the Upwork API integration (Part: Upwork API integration,
 * 2026-10-12). Deliberately hidden from the nav for everyone but the one
 * account this was built for — see sidebar-nav.tsx's ownerOnlyEmail check —
 * and every route this page calls sits behind UpworkApiOwnerGuard on the
 * backend regardless of whether someone finds this URL directly.
 *
 * Only "connect / status / disconnect" actually does anything right now.
 * The seven domain cards below mirror the application's own capability
 * list and show live once each one's backend stub (see
 * apps/api/src/upwork-integration/services/) is replaced with a real
 * implementation after Upwork approves the app.
 */
export default function UpworkApiSettingsPage() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ["upwork-api-status"],
    queryFn: () => api.getUpworkApiStatus() as Promise<ConnectionStatus>,
  });
  const callbackUrlQuery = useQuery({
    queryKey: ["upwork-api-callback-url"],
    queryFn: () => api.getUpworkApiCallbackUrl(),
  });
  const status = statusQuery.data;

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectError = params.get("upwork_api_error");
    const connected = params.get("upwork_api_connected");
    if (connectError) setError(connectError);
    if (connected) setNotice("Upwork API connected.");
    if (connectError || connected) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await api.getUpworkApiOAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      await api.disconnectUpworkApi();
      setNotice("Disconnected.");
      queryClient.invalidateQueries({ queryKey: ["upwork-api-status"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Upwork API Settings</h1>
            {statusQuery.isFetching && !statusQuery.isLoading && <Spinner className="h-3.5 w-3.5" />}
          </div>
          <p className="mt-0.5 text-xs text-ink/50">
            Connects our Upwork agency account so the dashboard can pull agency, bidding, Connects, job, and reporting data directly from Upwork.
          </p>
        </div>
        {status?.connected ? (
          <button
            type="button"
            disabled={disconnecting}
            onClick={disconnect}
            className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
          >
            {disconnecting ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : (
          <button
            type="button"
            disabled={connecting}
            onClick={connect}
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {connecting ? "Redirecting…" : "Connect Upwork account"}
          </button>
        )}
      </div>

      {(error || statusQuery.error) && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error ?? (statusQuery.error as Error).message}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">
          {notice}
        </div>
      )}

      <SectionCard title="Connection">
        {status?.connected ? (
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2 font-medium">
              Connected
              <StatusBadge status={status.status} />
            </div>
            <div className="text-xs text-ink/50">
              Connected {status.connectedAt ? new Date(status.connectedAt).toLocaleString() : "—"} · Token expires{" "}
              {status.tokenExpiresAt ? new Date(status.tokenExpiresAt).toLocaleString() : "—"}
            </div>
            {status.organizationName && <div className="text-xs text-ink/50">Organization: {status.organizationName}</div>}
            {status.scope && <div className="text-xs text-ink/50">Scope: {status.scope}</div>}
            {status.lastSyncError && <div className="mt-1 text-xs text-bad">{status.lastSyncError}</div>}
          </div>
        ) : (
          <p className="text-sm text-ink/55">Not connected yet. Click &ldquo;Connect Upwork account&rdquo; above once Upwork approves the API application.</p>
        )}
      </SectionCard>

      <SectionCard title="Upwork app registration">
        <p className="mb-2 text-xs text-ink/55">Use this exact callback/redirect URL in Upwork&apos;s API application form.</p>
        <code className="block rounded-md bg-ink/5 px-3 py-2 text-xs">
          {callbackUrlQuery.data?.callbackUrl ?? "Loading…"}
        </code>
      </SectionCard>

      <SectionCard title="Data modules (per the API application)">
        <div className="flex flex-col gap-2">
          {STUB_MODULES.map((m) => (
            <div key={m.label} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] px-3 py-2">
              <div>
                <div className="text-sm font-medium">{m.label}</div>
                <div className="text-xs text-ink/50">{m.hint}</div>
              </div>
              <span className="rounded-full bg-ink/8 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink/50">
                Pending Upwork approval
              </span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
