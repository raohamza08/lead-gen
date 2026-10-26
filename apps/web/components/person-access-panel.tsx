"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api-client";
import { Checkbox } from "./ui/checkbox";

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
  {
    key: "upworkApiAccess",
    label: "Upwork API — Shared Data",
    hint: "Backs a handful of Upwork API domain endpoints (activity, job discovery, client proposals, snapshots, reporting, timesheets, common reference data) with no dedicated sidebar page of their own — separate from the Upwork Agency pages below, which have their own per-page flags.",
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
 *  not everyone need the complete module"). Originally replaced a single
 *  upworkApiAccess checkbox that gated the whole 12-page group at once —
 *  each page now has its own flag, same granularity as the Dashboard
 *  Center tabs below. upworkApiAccess itself still exists (see
 *  MODULE_LABELS above) but was repurposed to gate a separate, smaller set
 *  of domain endpoints with no sidebar page of their own — not these 13. */
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

const ALL_MODULE_FLAG_KEYS: (keyof ModuleFlags)[] = [...MODULE_LABELS, ...UPWORK_AGENCY_LABELS, ...DASHBOARD_LABELS].map((l) => l.key);

function flagsOf(keys: (keyof ModuleFlags)[], value: boolean): Partial<ModuleFlags> {
  return Object.fromEntries(keys.map((k) => [k, value])) as Partial<ModuleFlags>;
}

/** Quick-apply bundles (Part: Consolidated Permissions panel, 2026-10-26,
 *  explicit user request — "apply presets or configure custom
 *  permissions"). Only pre-fills the in-memory draft below -- nothing is
 *  saved until the admin reviews and hits "Save access", same as any
 *  manual checkbox edit. Deliberately not a persisted/editable preset
 *  system (no such concept existed anywhere in this codebase before this)
 *  -- a fixed, small set of sensible bundles is what was actually asked
 *  for, not a presets-management feature nobody requested. */
const PRESETS: { name: string; flags: Partial<ModuleFlags> }[] = [
  { name: "Full Access", flags: flagsOf(ALL_MODULE_FLAG_KEYS, true) },
  { name: "View Only", flags: flagsOf(DASHBOARD_LABELS.map((l) => l.key), true) },
  {
    name: "Social Media Manager",
    flags: { socialMediaAccess: true, socialEngagementAccess: true, dashboardSocialAccess: true },
  },
  { name: "Email Manager", flags: { emailHubAccess: true, dashboardEmailAccess: true } },
  {
    name: "Upwork Specialist",
    flags: {
      upworkBiddingAccess: true,
      upworkInviteAccess: true,
      upworkRequestsAccess: true,
      upworkProposalWritingAccess: true,
      dashboardUpworkAccess: true,
      ...flagsOf(UPWORK_AGENCY_LABELS.map((l) => l.key), true),
    },
  },
  { name: "Clear All", flags: flagsOf(ALL_MODULE_FLAG_KEYS, false) },
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

  function applyPreset(flags: Partial<ModuleFlags>) {
    if (!data || data.isAdmin) return;
    setData({ ...data, modules: { ...data.modules, ...flags } });
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

      {!data.isAdmin && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Presets</h4>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => applyPreset(p.flags)}
                className="rounded-full border border-[var(--line)] px-3 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Modules</h4>
        {data.isAdmin ? (
          <p className="text-xs text-ink/50">Admins always have access to every module — this can&apos;t be restricted here.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {MODULE_LABELS.map(({ key, label, hint }) => (
              <Checkbox key={key} checked={data.modules[key]} onCheckedChange={() => toggleModule(key)} label={<span title={hint}>{label}</span>} />
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
              <Checkbox key={key} checked={data.modules[key]} onCheckedChange={() => toggleModule(key)} label={label} />
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
              <Checkbox key={key} checked={data.modules[key]} onCheckedChange={() => toggleModule(key)} label={label} />
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
                <Checkbox checked={a.granted} onCheckedChange={() => toggleEmailAccount(a.id)} label={a.mailboxLabel || a.address} />
                {a.granted && (
                  <span className="text-xs text-ink/60">
                    <Checkbox checked={a.canReply} onCheckedChange={(v) => setEmailCanReply(a.id, v)} label="can reply" />
                  </span>
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
                <Checkbox checked={a.granted} onCheckedChange={() => toggleSocialAccount(a.id)} label={`${a.platform} — ${a.displayName || a.username}`} />
                {a.granted && (
                  <>
                    <span className="text-xs text-ink/60">
                      <Checkbox checked={a.canPublish} onCheckedChange={(v) => setSocialFlag(a.id, "canPublish", v)} label="can publish" />
                    </span>
                    <span className="text-xs text-ink/60">
                      <Checkbox checked={a.canApprove} onCheckedChange={(v) => setSocialFlag(a.id, "canApprove", v)} label="can approve" />
                    </span>
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
                  <Checkbox key={p} checked={data.upworkProfiles.granted.includes(p)} onCheckedChange={() => toggleUpworkProfile(p)} label={p} />
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
