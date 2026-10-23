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
  organizationId?: string | null;
  organizationName?: string | null;
  connectedAt?: string;
  tokenExpiresAt?: string;
  lastSyncAt?: string;
  lastSyncError?: string | null;
}

// Connects usage, Bidding/proposals, and Invites removed from this list
// (Part: Upwork API integration, 2026-10-22) — all three are live now,
// rendered as real SectionCards below instead of "pending" placeholder
// rows. The remaining 4 domains follow the same path one at a time (see
// upwork-integration.module.ts's docblock).
const STUB_MODULES = [
  { label: "Offers", hint: "Blocked by a reproducible Upwork backend error (offersByAttributes times out) — confirmed real schema, not a missing permission. Re-checked automatically on every load; will start working if Upwork's issue clears." },
  { label: "Timesheets", hint: "Blocked by a team-level Upwork permission on the connected account (view hourly/charges data) — must be granted inside Upwork's own team management, not this app. Confirmed real schema otherwise, re-checked automatically." },
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
 * 2026-10-12). Gated by the standard upworkApiAccess module flag, same as
 * every other module — hidden from the nav (sidebar-nav.tsx) until granted
 * from Settings > Team, and every route this page calls is re-gated by
 * ModuleAccessGuard on the backend regardless of whether someone finds
 * this URL directly.
 *
 * "connect / status / disconnect", Connects usage, Bidding/proposals, and
 * Invites (Part: Upwork API integration, 2026-10-22 — the first 3 of 7 data
 * domains built against a real, introspection-confirmed schema) are live.
 * Bidding/proposals and Invites are deliberately separate SectionCards
 * backed by separate API routes/Prisma tables — explicit user requirement
 * ("I want them separate, bids and invites separately"), not just a UI
 * split over shared data. The remaining domain cards below mirror the
 * application's own capability list and go live once each one's backend
 * stub (see apps/api/src/upwork-integration/) is replaced with a real
 * implementation, one at a time. Agency & profile management was attempted
 * and found genuinely blocked by a missing Upwork scope — see that card's
 * own hint text.
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

  // Primary-admin-only endpoint — 403s silently for anyone else, which is
  // fine here: the picker list just doesn't render, the manual text field
  // below still works for everyone the module flag already lets in.
  const organizationsQuery = useQuery({
    queryKey: ["upwork-api-organizations"],
    queryFn: () => api.getUpworkApiOrganizations(),
    enabled: Boolean(status?.connected),
    retry: false,
  });

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [orgIdInput, setOrgIdInput] = useState("");
  const [savingOrgId, setSavingOrgId] = useState(false);

  useEffect(() => {
    if (status?.organizationId) setOrgIdInput(status.organizationId);
  }, [status?.organizationId]);

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

  async function saveOrganizationId() {
    const trimmed = orgIdInput.trim();
    if (!trimmed) return;
    setSavingOrgId(true);
    setError(null);
    try {
      const { organizationName } = await api.setUpworkApiOrganizationId(trimmed);
      setNotice(`Organization set to "${organizationName}".`);
      queryClient.invalidateQueries({ queryKey: ["upwork-api-status"] });
      queryClient.invalidateQueries({ queryKey: ["upwork-api-connects-usage"] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingOrgId(false);
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
            Connects our Upwork agency account. Once connected, the real data lives under the Upwork Agency section in the sidebar — this page only manages the connection itself.
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
            {status.lastSyncError && <div className="mt-1 text-xs text-bad">Last sync warning: {status.lastSyncError}</div>}

            {/* Manual organization-ID override (Part: Upwork API
                integration, 2026-10-22; org picker added 2026-10-23) — a
                fresh OAuth connect always lands on the personal account by
                default (Upwork's own companySelector always puts it first
                in the list), not any agency, unless this is set explicitly.
                The list below is real, live companySelector data — pick one
                to fill the field, still requires the explicit Save click
                below, same as typing it by hand. */}
            <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--line)] pt-3">
              <label className="text-xs font-medium text-ink/70">Organization ID (overrides which Upwork org data syncs from)</label>
              {organizationsQuery.data && organizationsQuery.data.length > 0 && (
                <div className="flex flex-col gap-1">
                  {organizationsQuery.data.map((o) => (
                    <button
                      key={o.organizationId}
                      type="button"
                      onClick={() => setOrgIdInput(o.organizationId)}
                      className="flex items-center justify-between gap-2 rounded-md border border-[var(--line)] px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-ink/5"
                    >
                      <span className="text-ink/80">
                        {o.title} <span className="text-ink/40">({o.organizationLegacyType ?? o.organizationType ?? "—"})</span>
                      </span>
                      <span className="shrink-0 text-ink/40">{o.organizationId}</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={orgIdInput}
                  onChange={(e) => setOrgIdInput(e.target.value)}
                  placeholder="e.g. 1748384846860713984"
                  className="h-9 flex-1 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
                />
                <button
                  type="button"
                  disabled={savingOrgId || !orgIdInput.trim()}
                  onClick={saveOrganizationId}
                  className="h-9 shrink-0 rounded-md border border-[var(--line)] px-3 text-sm text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                >
                  {savingOrgId ? "Checking…" : "Save"}
                </button>
              </div>
              <p className="text-[11px] text-ink/40">Click one of the real organizations above to fill the field, then Save — or type an ID by hand.</p>
            </div>
          </div>
        ) : status?.status === "EXPIRED" || status?.status === "ERROR" ? (
          // Distinct from "never connected" (Part: Upwork API integration,
          // 2026-10-22, found via a real incident: Upwork revoked the
          // refresh token during rapid disconnect/reconnect testing —
          // confirmed via Upwork's own "invalid_grant: Refresh token is
          // expired or revoked or not registered" response). The row still
          // exists with real history (organizationName/lastSyncError), so
          // showing "Not connected yet" with no explanation would hide a
          // real, actionable error -- surface it and point at the fix.
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex items-center gap-2 font-medium">
              Connection expired
              <StatusBadge status={status.status} />
            </div>
            {status.organizationName && <div className="text-xs text-ink/50">Was connected to: {status.organizationName}</div>}
            {status.lastSyncError && <div className="text-xs text-bad">{status.lastSyncError}</div>}
            <p className="mt-1 text-xs text-ink/55">Click &ldquo;Connect Upwork account&rdquo; above to re-authorize.</p>
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
