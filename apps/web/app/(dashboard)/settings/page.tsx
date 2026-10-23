"use client";

import Link from "next/link";
import { TeamSection } from "../../../components/team-section";
import { OrgBrandingSection } from "../../../components/org-branding-section";
import { getCurrentUser } from "../../../lib/api-client";

/**
 * General settings — the only things genuinely shared across every module
 * (who has an account at all, and how the org identifies itself). Anything
 * specific to one module lives in that module's own settings page instead
 * of being mixed in here: Lead Generation Settings (targeting, outreach
 * sending, case studies, agent prompts) and Email Hub Settings (connected
 * mailboxes, access, tags).
 */
export default function SettingsPage() {
  const isAdmin = getCurrentUser()?.role === "ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/settings/lead-generation"
          className="card card-interactive p-5"
        >
          <h2 className="text-sm font-semibold tracking-tight">Lead Generation Settings</h2>
        </Link>
        <Link
          href="/settings/email-hub"
          className="card card-interactive p-5"
        >
          <h2 className="text-sm font-semibold tracking-tight">Email Hub Settings</h2>
        </Link>
        <Link
          href="/settings/social-media"
          className="card card-interactive p-5"
        >
          <h2 className="text-sm font-semibold tracking-tight">Social Media Settings</h2>
        </Link>
        {isAdmin && (
          <Link
            href="/settings/upwork-proposal-writing"
            className="card card-interactive p-5"
          >
            <h2 className="text-sm font-semibold tracking-tight">Proposal Writing Settings</h2>
          </Link>
        )}
      </section>

      <TeamSection />
      <OrgBrandingSection />
    </div>
  );
}
