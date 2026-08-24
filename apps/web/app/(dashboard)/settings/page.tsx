"use client";

import Link from "next/link";
import { TeamSection } from "../../../components/team-section";
import { OrgBrandingSection } from "../../../components/org-branding-section";

/**
 * General settings — the only things genuinely shared across every module
 * (who has an account at all, and how the org identifies itself). Anything
 * specific to one module lives in that module's own settings page instead
 * of being mixed in here: Lead Generation Settings (targeting, outreach
 * sending, case studies, agent prompts) and Email Hub Settings (connected
 * mailboxes, access, tags).
 */
export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Users and company identity. Module-specific settings live with their module.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/settings/lead-generation"
          className="card card-interactive p-5"
        >
          <h2 className="text-sm font-semibold tracking-tight">Lead Generation Settings</h2>
          <p className="mt-1 text-xs text-ink/50">
            Niche targeting, outreach sending accounts, case studies, and agent prompts.
          </p>
        </Link>
        <Link
          href="/settings/email-hub"
          className="card card-interactive p-5"
        >
          <h2 className="text-sm font-semibold tracking-tight">Email Hub Settings</h2>
          <p className="mt-1 text-xs text-ink/50">
            Connected mailboxes, per-user access, and tags for the unified inbox.
          </p>
        </Link>
      </section>

      <TeamSection />
      <OrgBrandingSection />
    </div>
  );
}
