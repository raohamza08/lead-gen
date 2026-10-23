"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

/** Team Invite (Part: Upwork API integration — Agency Tools, 2026-10-23)
 *  — real `inviteToTeam` mutation, `flow: AGENCY_INVITE_TO_TEAM`.
 *  Primary-admin only for now (see sidebar-nav.tsx). This sends a REAL
 *  email on Upwork's side once submitted — never test-executed end-to-
 *  end (no safe recipient existed to verify against), schema-verified
 *  via live introspection only. `landingUrl` is left as a required
 *  manual field rather than a hardcoded guess, since the exact URL
 *  Upwork expects for this flow was never confirmed live. */
export default function TeamInvitePage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const orgsQuery = useQuery({
    queryKey: ["upwork-api-organizations"],
    queryFn: () => api.getUpworkApiOrganizations(),
    enabled: connected,
  });
  const orgs = orgsQuery.data ?? [];

  const [email, setEmail] = useState("");
  const [targetOrganizationId, setTargetOrganizationId] = useState("");
  const [landingUrl, setLandingUrl] = useState("https://www.upwork.com/ab/team");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!targetOrganizationId && orgs.length > 0) {
      const agency = orgs.find((o) => o.organizationLegacyType === "Vendor" && o.organizationType === "Business") ?? orgs[0];
      setTargetOrganizationId(agency.organizationId);
    }
  }, [orgs, targetOrganizationId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await api.inviteUpworkTeamMember({ email: email.trim(), targetOrganizationId, landingUrl: landingUrl.trim() });
      if (res.succeeded.length > 0) {
        setResult({ ok: true, message: `Invitation sent to ${email.trim()}.` });
        setEmail("");
      } else {
        const failure = res.failed[0];
        setResult({ ok: false, message: failure?.message ?? "Upwork rejected the invitation for an unknown reason." });
      }
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Team Invite" />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Team Invite</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Invite someone to join this Upwork agency&apos;s team directly, without going through Upwork&apos;s own UI. Submitting sends a real
          email on Upwork&apos;s side immediately — this has not been end-to-end tested with a real invite, so double-check the details below
          before sending.
        </p>
      </div>

      <SectionCard title="Send invitation">
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink/70">Invitee email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className="h-9 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink/70">Invite into which organization</label>
            <select
              value={targetOrganizationId}
              onChange={(e) => setTargetOrganizationId(e.target.value)}
              className="h-9 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
            >
              {orgs.map((o) => (
                <option key={o.organizationId} value={o.organizationId}>
                  {o.title} ({o.organizationLegacyType ?? o.organizationType ?? "—"})
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink/70">Landing URL (where the invitee lands after accepting)</label>
            <input
              required
              value={landingUrl}
              onChange={(e) => setLandingUrl(e.target.value)}
              className="h-9 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
            />
            <p className="text-[11px] text-ink/40">A reasonable default is prefilled — not confirmed live, adjust if Upwork rejects it.</p>
          </div>

          <button
            type="submit"
            disabled={submitting || !email.trim() || !targetOrganizationId || !landingUrl.trim()}
            className="h-9 w-fit rounded-md bg-accent px-4 text-sm text-white disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Send invitation"}
          </button>

          {result && <p className={`text-sm ${result.ok ? "text-good" : "text-bad"}`}>{result.message}</p>}
        </form>
      </SectionCard>
    </div>
  );
}
