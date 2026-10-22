"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api-client";

interface ModuleFlags {
  leadGenAccess: boolean;
  emailHubAccess: boolean;
  socialMediaAccess: boolean;
  socialEngagementAccess: boolean;
  upworkAccess: boolean;
  upworkBiddingAccess: boolean;
  upworkInviteAccess: boolean;
  upworkRequestsAccess: boolean;
  metaAdsAccess: boolean;
  upworkApiAccess: boolean;
  upworkProposalWritingAccess: boolean;
  upworkAgencyOverviewAccess: boolean;
  upworkAgencyOrganizationAccess: boolean;
  upworkAgencyTransactionsAccess: boolean;
  upworkAgencyBiddingAccess: boolean;
  upworkAgencyInvitesAccess: boolean;
  upworkAgencyContractProposalsAccess: boolean;
  upworkAgencySubmitProposalAccess: boolean;
  upworkAgencyWorkHistoryAccess: boolean;
  upworkAgencyFreelancersAccess: boolean;
  upworkAgencyRoomsAccess: boolean;
  upworkAgencyJobsAccess: boolean;
  upworkAgencyOntologyAccess: boolean;
  upworkAgencyConnectionAccess: boolean;
  dashboardOverviewAccess: boolean;
  dashboardLeadsAccess: boolean;
  dashboardEmailAccess: boolean;
  dashboardInboxAccess: boolean;
  dashboardSocialAccess: boolean;
  dashboardUpworkAccess: boolean;
  dashboardMetaAdsAccess: boolean;
  dashboardWebsiteAnalyticsAccess: boolean;
  dashboardPipelineAccess: boolean;
  dashboardTeamAccess: boolean;
  dashboardActivityAccess: boolean;
  dashboardBenchmarksAccess: boolean;
}

interface EmailAccountRow {
  id: string;
  address: string;
  mailboxLabel: string | null;
  granted: boolean;
  canReply: boolean;
}

interface SocialAccountRow {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
  granted: boolean;
  canPublish: boolean;
  canApprove: boolean;
}

interface UpworkProfileAccess {
  available: string[];
  granted: string[];
}

interface AccessData {
  isAdmin: boolean;
  modules: ModuleFlags;
  emailAccounts: EmailAccountRow[];
  socialAccounts: SocialAccountRow[];
  upworkProfiles: UpworkProfileAccess;
}

const MODULE_LABELS: { key: keyof ModuleFlags; label: string; hint?: string }[] = [
  { key: "leadGenAccess", label: "Lead Generation" },
  { key: "emailHubAccess", label: "Email Hub" },
  { key: "socialMediaAccess", label: "Social Media" },
  {
    key: "socialEngagementAccess",
    label: "Social Messaging + Engagement",
    hint: "Narrower than Social Media — only each platform's Inbox/Feed tabs and the Engagement Center's comments, not Create Post/Calendar/Analytics/Automations/Accounts. Redundant if Social Media is already checked.",
  },
  // Upwork Proposals is three independent toggles, not one (Part: Upwork
  // Requests, 2026-10-01, explicit user request — "not everyone needs
  // everything... hide bidding and invites for them") -- e.g. a Project
  // Manager who should only see Requests, not Bidding/Invite.
  { key: "upworkBiddingAccess", label: "Upwork — Bidding" },
  { key: "upworkInviteAccess", label: "Upwork — Invite" },
  { key: "upworkRequestsAccess", label: "Upwork — Requests" },
  { key: "metaAdsAccess", label: "Meta Ads" },
  {
    key: "upworkProposalWritingAccess",
    label: "Upwork — Proposal Writing",
    hint: "Paste a job link and get an AI-generated cover letter. Separate from Bidding/Invite/Requests above.",
  },
];

/** Which tabs of the cross-team Dashboard Center (/dashboards) this person
 *  can see (Part: Dashboard Center per-user access, 2026-10-21, explicit
 *  user request — "I want that i got option to show different dashboard to
 *  different persons"). Independent of the module flags above — e.g.
 *  dashboardUpworkAccess controls visibility of the Dashboard Center's
 *  Upwork tab specifically, separate from upworkBiddingAccess/
 *  upworkInviteAccess/upworkRequestsAccess which gate the actual Upwork
 *  tool pages elsewhere in the sidebar. Admins/Managers get every tab by
 *  default when created (see UsersService's role-default seeding) but that
 *  default is just a starting point, editable here same as any other flag. */
const DASHBOARD_LABELS: { key: keyof ModuleFlags; label: string }[] = [
  { key: "dashboardOverviewAccess", label: "Overview" },
  { key: "dashboardLeadsAccess", label: "Leads" },
  { key: "dashboardEmailAccess", label: "Email Campaigns" },
  { key: "dashboardInboxAccess", label: "Unified Inbox" },
  { key: "dashboardSocialAccess", label: "Social Inbox" },
  { key: "dashboardUpworkAccess", label: "Upwork" },
  { key: "dashboardMetaAdsAccess", label: "Meta Ads" },
  { key: "dashboardWebsiteAnalyticsAccess", label: "Website Analytics" },
  { key: "dashboardPipelineAccess", label: "Pipeline" },
  { key: "dashboardTeamAccess", label: "Team Performance" },
  { key: "dashboardActivityAccess", label: "Activity / Audit" },
  { key: "dashboardBenchmarksAccess", label: "Benchmarks" },
];

/** Per-page access into the "Upwork Agency" sidebar group (Part: Upwork
 *  API integration — per-module access, 2026-10-23, explicit user request
 *  — "I need separate access for each module in the Upwork Agency tab,
 *  not everyone need the complete module"). Replaces the single
 *  upworkApiAccess checkbox that used to gate the whole 12-page group at
 *  once — each page now has its own flag, same granularity as the
 *  Dashboard Center tabs below. */
const UPWORK_AGENCY_LABELS: { key: keyof ModuleFlags; label: string }[] = [
  { key: "upworkAgencyOverviewAccess", label: "Overview" },
  { key: "upworkAgencyOrganizationAccess", label: "Organization" },
  { key: "upworkAgencyTransactionsAccess", label: "Transactions" },
  { key: "upworkAgencyBiddingAccess", label: "Bidding & Proposals" },
  { key: "upworkAgencyInvitesAccess", label: "Invites" },
  { key: "upworkAgencyContractProposalsAccess", label: "Contract Proposals" },
  { key: "upworkAgencySubmitProposalAccess", label: "Submit Proposal" },
  { key: "upworkAgencyWorkHistoryAccess", label: "Work History" },
  { key: "upworkAgencyFreelancersAccess", label: "Freelancers" },
  { key: "upworkAgencyRoomsAccess", label: "Rooms & Messages" },
  { key: "upworkAgencyJobsAccess", label: "Marketplace Jobs" },
  { key: "upworkAgencyOntologyAccess", label: "Ontology" },
  { key: "upworkAgencyConnectionAccess", label: "Connection Settings" },
];

/**
 * Everything one person can touch, in one place (Part: Person Access) —
 * module toggles plus which specific email/social accounts they're granted,
 * read and written from the person's side rather than each account's own
 * settings page. Writes go through the same EmailAccountAccess/
 * SocialAccountAccess rows those account-centric pages already use, so both
 * stay in sync automatically.
 */
export function PersonAccessPanel({ userId }: { userId: string }) {
  const [data, setData] = useState<AccessData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function refresh() {
    api
      .getUserAccess(userId)
      .then((res) => setData(res as AccessData))
      .catch((err) => setError((err as Error).message));
  }

  useEffect(refresh, [userId]);

  function toggleModule(key: keyof ModuleFlags) {
    if (!data || data.isAdmin) return;
    setData({ ...data, modules: { ...data.modules, [key]: !data.modules[key] } });
  }

  function toggleEmailAccount(id: string) {
    if (!data) return;
    setData({
      ...data,
      emailAccounts: data.emailAccounts.map((a) => (a.id === id ? { ...a, granted: !a.granted } : a)),
    });
  }

  function setEmailCanReply(id: string, canReply: boolean) {
    if (!data) return;
    setData({ ...data, emailAccounts: data.emailAccounts.map((a) => (a.id === id ? { ...a, canReply } : a)) });
  }

  function toggleSocialAccount(id: string) {
    if (!data) return;
    setData({
      ...data,
      socialAccounts: data.socialAccounts.map((a) => (a.id === id ? { ...a, granted: !a.granted } : a)),
    });
  }

  function setSocialFlag(id: string, flag: "canPublish" | "canApprove", value: boolean) {
    if (!data) return;
    setData({
      ...data,
      socialAccounts: data.socialAccounts.map((a) => (a.id === id ? { ...a, [flag]: value } : a)),
    });
  }

  function toggleUpworkProfile(profileName: string) {
    if (!data || data.isAdmin) return;
    const granted = data.upworkProfiles.granted.includes(profileName)
      ? data.upworkProfiles.granted.filter((p) => p !== profileName)
      : [...data.upworkProfiles.granted, profileName];
    setData({ ...data, upworkProfiles: { ...data.upworkProfiles, granted } });
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.updateUserAccess(userId, {
        modules: data.isAdmin ? undefined : data.modules,
        emailAccounts: data.emailAccounts.map((a) => ({ accountId: a.id, granted: a.granted, canReply: a.canReply })),
        socialAccounts: data.socialAccounts.map((a) => ({
          accountId: a.id,
          granted: a.granted,
          canPublish: a.canPublish,
          canApprove: a.canApprove,
        })),
        upworkProfiles: data.isAdmin ? undefined : data.upworkProfiles.granted,
      });
      setNotice("Saved.");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!data) {
    return error ? <p className="text-xs text-bad">{error}</p> : <p className="text-xs text-ink/50">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-[var(--line)] bg-ink/[0.02] p-4">
      {error && <div className="rounded border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-2 py-1.5 text-xs text-bad">{error}</div>}
      {notice && <div className="rounded border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-2 py-1.5 text-xs text-good">{notice}</div>}

      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Modules</h4>
        {data.isAdmin ? (
          <p className="text-xs text-ink/50">Admins always have access to every module — this can&apos;t be restricted here.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {MODULE_LABELS.map(({ key, label, hint }) => (
              <label key={key} className="flex items-center gap-1.5 text-sm" title={hint}>
                <input type="checkbox" checked={data.modules[key]} onChange={() => toggleModule(key)} />
                {label}
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Upwork Agency pages</h4>
        {data.isAdmin ? (
          <p className="text-xs text-ink/50">Admins always see every Upwork Agency page — this can&apos;t be restricted here.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {UPWORK_AGENCY_LABELS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={data.modules[key]} onChange={() => toggleModule(key)} />
                {label}
              </label>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Dashboard Center tabs</h4>
        {data.isAdmin ? (
          <p className="text-xs text-ink/50">Admins always see every Dashboard Center tab — this can&apos;t be restricted here.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {DASHBOARD_LABELS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={data.modules[key]} onChange={() => toggleModule(key)} />
                {label}
              </label>
            ))}
          </div>
        )}
      </div>

      {data.emailAccounts.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Email accounts</h4>
          <div className="flex flex-col gap-1.5">
            {data.emailAccounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={a.granted} onChange={() => toggleEmailAccount(a.id)} />
                  {a.mailboxLabel || a.address}
                </label>
                {a.granted && (
                  <label className="flex items-center gap-1.5 text-xs text-ink/60">
                    <input type="checkbox" checked={a.canReply} onChange={(e) => setEmailCanReply(a.id, e.target.checked)} />
                    can reply
                  </label>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.socialAccounts.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Social accounts</h4>
          <div className="flex flex-col gap-1.5">
            {data.socialAccounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={a.granted} onChange={() => toggleSocialAccount(a.id)} />
                  {a.platform} — {a.displayName || a.username}
                </label>
                {a.granted && (
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-ink/60">
                      <input type="checkbox" checked={a.canPublish} onChange={(e) => setSocialFlag(a.id, "canPublish", e.target.checked)} />
                      can publish
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-ink/60">
                      <input type="checkbox" checked={a.canApprove} onChange={(e) => setSocialFlag(a.id, "canApprove", e.target.checked)} />
                      can approve
                    </label>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.upworkProfiles.available.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Upwork profiles/IDs (Requests)</h4>
          {data.isAdmin ? (
            <p className="text-xs text-ink/50">Admins can request hours against every profile — this can&apos;t be restricted here.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-ink/50">
                {data.upworkProfiles.granted.length === 0
                  ? "No profiles restricted yet — this person can request hours against any profile. Check specific ones below to limit them."
                  : "Restricted to the checked profiles below."}
              </p>
              <div className="flex flex-wrap gap-3">
                {data.upworkProfiles.available.map((p) => (
                  <label key={p} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={data.upworkProfiles.granted.includes(p)} onChange={() => toggleUpworkProfile(p)} />
                    {p}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="self-start rounded-md bg-accent px-4 py-2 text-xs text-white disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save access"}
      </button>
    </div>
  );
}
