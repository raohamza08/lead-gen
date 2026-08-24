"use client";

import Link from "next/link";
import { EmailHubAccountsSection } from "../../../../components/email-hub-accounts-section";
import { EmailHubAccessSection } from "../../../../components/email-hub-access-section";
import { EmailHubTagsSection } from "../../../../components/email-hub-tags-section";

export default function EmailHubSettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/settings" className="text-xs text-accent hover:underline">
          ← General settings
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">Email Hub Settings</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Connected mailboxes, who can access each one, and tags for the unified inbox.
        </p>
      </div>

      <EmailHubAccountsSection />
      <EmailHubAccessSection />
      <EmailHubTagsSection />
    </div>
  );
}
