"use client";

import Link from "next/link";
import { getCurrentUser } from "../../../../lib/api-client";
import { EmailHubAccountsSection } from "../../../../components/email-hub-accounts-section";
import { EmailHubAccessSection } from "../../../../components/email-hub-access-section";
import { EmailHubTagsSection } from "../../../../components/email-hub-tags-section";

/**
 * Admin-only page: mailbox setup here includes real send/IMAP credentials,
 * so unlike every other settings page this one isn't even viewable by a
 * non-admin (not just edit-restricted) — explicit decision, matches the
 * backend's @Roles(ADMIN) on the underlying account list/health/mutation
 * endpoints (client-side check only for the page shell; the real
 * enforcement is server-side, same as everywhere else in this app).
 */
export default function EmailHubSettingsPage() {
  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === "ADMIN";

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

      {isAdmin ? (
        <>
          <EmailHubAccountsSection />
          <EmailHubAccessSection />
          <EmailHubTagsSection />
        </>
      ) : (
        <p className="rounded-lg border border-[var(--line)] px-4 py-3 text-sm text-ink/50">
          Email Hub Settings is admin-only. Ask an admin if you need something changed here.
        </p>
      )}
    </div>
  );
}
