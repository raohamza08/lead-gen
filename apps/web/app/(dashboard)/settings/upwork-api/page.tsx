"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, KpiStrip, StatTile, MiniTrendCard, DataTable, AXIS_PROPS, GRID_PROPS, TOOLTIP_STYLE } from "../../../../components/chart-kit";
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

  const connectsQuery = useQuery({
    queryKey: ["upwork-api-connects-usage"],
    queryFn: () => api.getUpworkApiConnectsUsage(),
    enabled: Boolean(status?.connected),
  });
  const connects = connectsQuery.data;

  const proposalsQuery = useQuery({
    queryKey: ["upwork-api-proposals"],
    queryFn: () => api.getUpworkApiProposals(),
    enabled: Boolean(status?.connected),
  });
  const proposals = proposalsQuery.data;

  const invitesQuery = useQuery({
    queryKey: ["upwork-api-invites"],
    queryFn: () => api.getUpworkApiInvites(),
    enabled: Boolean(status?.connected),
  });
  const invites = invitesQuery.data;

  const agencyProfileQuery = useQuery({
    queryKey: ["upwork-api-agency-profile"],
    queryFn: () => api.getUpworkApiAgencyProfile(),
    enabled: Boolean(status?.connected),
  });
  const agencyProfile = agencyProfileQuery.data;

  const transactionsQuery = useQuery({
    queryKey: ["upwork-api-transactions"],
    queryFn: () => api.getUpworkApiTransactions(),
    enabled: Boolean(status?.connected),
  });
  const transactions = transactionsQuery.data;

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
            {status.lastSyncError && <div className="mt-1 text-xs text-bad">Last sync warning: {status.lastSyncError}</div>}

            {/* Manual organization-ID override (Part: Upwork API
                integration, 2026-10-22) — Upwork's automatic org-detection
                is blocked by a scope this app doesn't have, so every call
                silently defaults to the logged-in user's PERSONAL account
                unless this is set explicitly. Find the real ID from the
                agency's own public Upwork page (it's embedded in the
                org-logo image URL, e.g. assets.static-upwork.com/org-logo/
                &lt;id&gt;) or by granting the missing scope and letting Upwork's
                own company selector resolve it instead. */}
            <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--line)] pt-3">
              <label className="text-xs font-medium text-ink/70">Organization ID (overrides which Upwork org data syncs from)</label>
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
              <p className="text-[11px] text-ink/40">
                Automatic detection is currently blocked by a missing Upwork app permission (company selector). Find your org&apos;s real ID on its
                public Upwork agency page — it&apos;s embedded in the logo image URL.
              </p>
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

      {status?.connected && (
        <SectionCard title="Connects usage" subtitle="Live balance and spend history, synced every 6 hours from Upwork's real API.">
          {connectsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
          {connectsQuery.error && <p className="text-sm text-bad">{(connectsQuery.error as Error).message}</p>}
          {connects && !connects.current && (
            <p className="text-sm text-ink/55">No sync has run yet — the first sync happens shortly after connecting, then every 6 hours.</p>
          )}
          {connects?.current && (
            <div className="flex flex-col gap-4">
              <KpiStrip>
                <StatTile label="Connects Balance" value={connects.current.connectsBalance} />
                <StatTile label="Free" value={connects.current.connectsBalanceFree} />
                <StatTile label="Paid" value={connects.current.connectsBalancePaid} />
                <StatTile label="Rollover" value={connects.current.rolloverBalance} />
              </KpiStrip>

              {connects.history.length > 1 && (
                <MiniTrendCard
                  label="Balance over time"
                  value={String(connects.current.connectsBalance)}
                  color="var(--accent)"
                  data={connects.history.map((h) => ({ date: new Date(h.capturedAt).toLocaleDateString(), balance: h.connectsBalance }))}
                  dataKey="balance"
                  xKey="date"
                  axisProps={AXIS_PROPS}
                  gridProps={GRID_PROPS}
                  tooltipProps={TOOLTIP_STYLE}
                />
              )}

              {connects.recentTransactions.length > 0 && (
                <div>
                  <div className="mb-2 text-sm font-medium text-ink">Recent transactions</div>
                  <DataTable
                    rowKey={(t) => t.id}
                    columns={[
                      { key: "date", header: "Date", render: (t) => new Date(t.occurredAt).toLocaleString() },
                      { key: "type", header: "Type", render: (t) => t.transactionType },
                      { key: "reason", header: "Reason", render: (t) => t.reason ?? "—" },
                      { key: "job", header: "Job", render: (t) => t.jobTitle ?? "—" },
                      { key: "amount", header: "Amount", render: (t) => t.amountDisplay, numeric: true },
                    ]}
                    rows={connects.recentTransactions}
                  />
                </div>
              )}
            </div>
          )}
        </SectionCard>
      )}

      {status?.connected && (
        <SectionCard
          title="Bidding &amp; proposals"
          subtitle={`Your real submitted proposals/bids${status.organizationName ? ` for ${status.organizationName}` : ""}, synced every 6 hours from Upwork's real API.`}
        >
          {proposalsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
          {proposalsQuery.error && <p className="text-sm text-bad">{(proposalsQuery.error as Error).message}</p>}
          {proposals && proposals.totalCount === 0 && (
            <p className="text-sm text-ink/55">No sync has run yet — the first sync happens shortly after connecting, then every 6 hours.</p>
          )}
          {proposals && proposals.totalCount > 0 && (
            <div className="flex flex-col gap-4">
              <KpiStrip>
                {Object.entries(proposals.countByStatus)
                  .filter(([, count]) => count > 0)
                  .map(([status_, count]) => (
                    <StatTile key={status_} label={status_} value={count} />
                  ))}
              </KpiStrip>

              {proposals.recent.length > 0 && (
                <div>
                  <div className="mb-2 text-sm font-medium text-ink">Recently updated</div>
                  <DataTable
                    rowKey={(p) => p.id}
                    columns={[
                      { key: "job", header: "Job", render: (p) => p.jobTitle ?? "—" },
                      { key: "freelancer", header: "Freelancer", render: (p) => p.freelancerName ?? "—" },
                      { key: "status", header: "Status", render: (p) => p.status },
                      { key: "rate", header: "Rate", render: (p) => p.chargeRateDisplay ?? "—", numeric: true },
                      { key: "updated", header: "Updated", render: (p) => (p.upworkModifiedAt ? new Date(p.upworkModifiedAt).toLocaleString() : "—") },
                    ]}
                    rows={proposals.recent}
                  />
                </div>
              )}
            </div>
          )}
        </SectionCard>
      )}

      {status?.connected && (
        <SectionCard
          title="Invites"
          subtitle={`Client invitations your freelancers received${status.organizationName ? ` under ${status.organizationName}` : ""}, synced every 6 hours — tracked separately from the Bidding/proposals data above.`}
        >
          {invitesQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
          {invitesQuery.error && <p className="text-sm text-bad">{(invitesQuery.error as Error).message}</p>}
          {invites && invites.totalCount === 0 && (
            <p className="text-sm text-ink/55">No sync has run yet — the first sync happens shortly after connecting, then every 6 hours.</p>
          )}
          {invites && invites.totalCount > 0 && (
            <div className="flex flex-col gap-4">
              <KpiStrip>
                {Object.entries(invites.countByStatus)
                  .filter(([, count]) => count > 0)
                  .map(([status_, count]) => (
                    <StatTile key={status_} label={status_} value={count} />
                  ))}
              </KpiStrip>

              {invites.recent.length > 0 && (
                <div>
                  <div className="mb-2 text-sm font-medium text-ink">Recently updated</div>
                  <DataTable
                    rowKey={(i) => i.id}
                    columns={[
                      { key: "job", header: "Job", render: (i) => i.jobTitle ?? "—" },
                      { key: "client", header: "Client", render: (i) => i.clientName ?? "—" },
                      { key: "freelancer", header: "Sent to", render: (i) => i.freelancerName ?? "—" },
                      { key: "status", header: "Status", render: (i) => i.status ?? "—" },
                      { key: "updated", header: "Updated", render: (i) => (i.upworkModifiedAt ? new Date(i.upworkModifiedAt).toLocaleString() : "—") },
                    ]}
                    rows={invites.recent}
                  />
                </div>
              )}
            </div>
          )}
        </SectionCard>
      )}

      {status?.connected && (
        <SectionCard title="Organization &amp; Agency" subtitle="Real identity fields from Upwork's own organization record.">
          {agencyProfileQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
          {agencyProfileQuery.error && <p className="text-sm text-bad">{(agencyProfileQuery.error as Error).message}</p>}
          {agencyProfile && (
            <div className="flex flex-col gap-4">
              <KpiStrip>
                <StatTile label="Account type" value={agencyProfile.profile.type ?? "—"} />
                <StatTile label="Upwork classification" value={agencyProfile.profile.flag?.agency ? "Agency" : agencyProfile.profile.flag?.individual ? "Individual" : "—"} />
                <StatTile label="Active" value={agencyProfile.profile.active ? "Yes" : "No"} />
                <StatTile label="Created" value={agencyProfile.profile.creationDate ? new Date(agencyProfile.profile.creationDate).toLocaleDateString() : "—"} />
              </KpiStrip>
              <div className="text-xs text-ink/50">
                Upwork org ID {agencyProfile.profile.id} · legacy type {agencyProfile.profile.legacyType ?? "—"}
                {agencyProfile.profile.flag && (
                  <> · flags: {Object.entries(agencyProfile.profile.flag).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}</>
                )}
              </div>
              {agencyProfile.companyDetailsAvailable && agencyProfile.companyDetails ? (
                <div className="text-sm text-ink/70">
                  Company: {agencyProfile.companyDetails.companyName ?? agencyProfile.companyDetails.name ?? "—"}
                  {agencyProfile.companyDetails.city && <> · {agencyProfile.companyDetails.city}</>}
                  {agencyProfile.companyDetails.staffsTotalCount != null && <> · {agencyProfile.companyDetails.staffsTotalCount} staff</>}
                </div>
              ) : (
                <div className="rounded-lg border border-[var(--line)] bg-ink/[0.03] px-3 py-2 text-xs text-ink/55">
                  Company and staff details are unavailable: {agencyProfile.companyDetailsLimitation}
                </div>
              )}
            </div>
          )}
        </SectionCard>
      )}

      {status?.connected && (
        <SectionCard title="Transactions &amp; Financial History" subtitle="Real financial ledger synced every 6 hours from Upwork's real API — fees, invoices, withdrawals, refunds.">
          {transactionsQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
          {transactionsQuery.error && <p className="text-sm text-bad">{(transactionsQuery.error as Error).message}</p>}
          {transactions && transactions.totalCount === 0 && (
            <p className="text-sm text-ink/55">No sync has run yet — the first sync happens shortly after connecting, then every 6 hours.</p>
          )}
          {transactions && transactions.totalCount > 0 && (
            <div className="flex flex-col gap-4">
              <KpiStrip>
                <StatTile label="Total transactions" value={transactions.totalCount} />
                {transactions.countBySubtype.slice(0, 3).map((s) => (
                  <StatTile key={`${s.subtype}-${s.currency}`} label={s.subtype ?? "Other"} value={s.count} />
                ))}
              </KpiStrip>

              {transactions.recent.length > 0 && (
                <div>
                  <div className="mb-2 text-sm font-medium text-ink">Recent transactions</div>
                  <DataTable
                    rowKey={(t) => t.id}
                    columns={[
                      { key: "date", header: "Date", render: (t) => (t.occurredAt ? new Date(t.occurredAt).toLocaleDateString() : "—") },
                      { key: "subtype", header: "Type", render: (t) => t.accountingSubtype ?? t.type ?? "—" },
                      { key: "description", header: "Description", render: (t) => <span className="line-clamp-1 max-w-xs">{t.description ?? "—"}</span> },
                      { key: "amount", header: "Amount", render: (t) => t.amountDisplay ? `${t.amountDisplay} ${t.amountCurrency ?? ""}` : "—", numeric: true },
                    ]}
                    rows={transactions.recent}
                  />
                </div>
              )}
            </div>
          )}
        </SectionCard>
      )}

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
