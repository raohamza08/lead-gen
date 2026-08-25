"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../lib/api-client";

interface SendingMailbox {
  id: string;
  address: string;
  displayName: string | null;
  dailyLimit: number;
  sentToday: number;
}

/**
 * Read-only: which mailbox(es) will actually be used to send outreach.
 * Mailbox setup itself (credentials, IMAP, the Sending switch) moved to
 * Email Hub Settings, admin-only — Lead Generation only needs to know what
 * will send, not configure it.
 */
export function SendingMailboxesSection() {
  const [mailboxes, setMailboxes] = useState<SendingMailbox[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSendingMailboxes()
      .then((res) => setMailboxes(res as SendingMailbox[]))
      .catch((err) => setError((err as Error).message));
  }, []);

  return (
    <section className="rounded-xl border border-[var(--line)] p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold tracking-tight">Sending mailboxes</h2>
        <p className="mt-0.5 text-xs text-ink/50">
          Read-only — whichever mailboxes are currently enabled to send. Set up mailboxes and turn Sending
          on or off from{" "}
          <Link href="/settings/email-hub" className="text-accent hover:underline">
            Email Hub Settings
          </Link>{" "}
          (admin only).
        </p>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      {!error && !mailboxes && <p className="text-sm text-ink/50">Loading…</p>}

      {mailboxes && mailboxes.length === 0 && (
        <p className="text-sm text-ink/50">
          No mailbox is currently enabled to send. Outreach will fail until an admin turns one on in Email
          Hub Settings.
        </p>
      )}

      {mailboxes && mailboxes.length > 0 && (
        <ul className="flex flex-col gap-2">
          {mailboxes.map((m) => (
            <li key={m.id} className="flex items-center justify-between rounded-lg border border-[var(--line)] px-3 py-2 text-sm">
              <span>
                {m.address}
                {m.displayName && <span className="text-ink/50"> — shown as &ldquo;{m.displayName}&rdquo;</span>}
              </span>
              <span className="tabular text-xs text-ink/50">
                {m.sentToday}/{m.dailyLimit} sent today
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
