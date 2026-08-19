"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api-client";

interface PendingApproval {
  id: string;
  subject: string;
  bodyHtml: string;
  rationale: {
    hook?: string; insight?: string; evidence?: string | null; reframe?: string; cta?: string;
    reviewNotes?: string[];
  } | null;
  lead: { id: string; companyName: string; contactName: string | null; email: string | null };
}

interface UpcomingSend {
  id: string;
  subject: string;
  sequenceStep: number;
  scheduledAt: string | null;
  lead: { id: string; companyName: string };
  account: { address: string } | null;
}

interface MailboxHealth {
  id: string;
  provider: string;
  address: string;
  status: string;
  dailyLimit: number;
  hourlyLimit: number;
  warmupActive: boolean;
  oauthConfigured: boolean;
  smtpConfigured: boolean;
  sentToday: number;
}

export default function SequencesPage() {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingSend[]>([]);
  const [mailboxes, setMailboxes] = useState<MailboxHealth[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    Promise.all([api.getPendingApprovals(), api.getUpcomingSends(), api.getEmailAccountsHealth()])
      .then(([a, u, m]) => {
        setApprovals(a as PendingApproval[]);
        setUpcoming(u as UpcomingSend[]);
        setMailboxes(m as MailboxHealth[]);
      })
      .catch((err) => setError((err as Error).message));
  }

  useEffect(refresh, []);

  async function act(leadId: string, emailMessageId: string, action: "APPROVE" | "REJECT") {
    setBusyId(emailMessageId);
    try {
      await api.approveEmail(leadId, { emailMessageId, action });
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-bad">{error}</p>}

      <section className="rounded-lg border border-[var(--line)] p-5">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-ink/60">
          Email #3 Approval Queue ({approvals.length})
        </h2>
        <div className="flex flex-col gap-3">
          {approvals.map((a) => (
            <div key={a.id} className="rounded border border-[var(--line)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link href={`/leads/${a.lead.id}`} className="font-medium text-accent">
                    {a.lead.companyName}
                  </Link>
                  <p className="mt-1 text-sm font-medium">{a.subject}</p>
                  {a.rationale?.evidence && (
                    <p className="mt-1 text-xs text-ink/60">Evidence used: {a.rationale.evidence}</p>
                  )}
                  {a.rationale?.reviewNotes && a.rationale.reviewNotes.length > 0 && (
                    <p className="mt-1 rounded bg-gold/10 px-2 py-1 text-xs text-gold">
                      Needs a look: {a.rationale.reviewNotes.join("; ")}
                    </p>
                  )}
                  <div
                    className="prose prose-sm mt-2 max-w-none text-xs text-ink/80"
                    dangerouslySetInnerHTML={{ __html: a.bodyHtml }}
                  />
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    disabled={busyId === a.id}
                    onClick={() => act(a.lead.id, a.id, "APPROVE")}
                    className="rounded bg-good px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busyId === a.id}
                    onClick={() => act(a.lead.id, a.id, "REJECT")}
                    className="rounded bg-bad px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
          {approvals.length === 0 && <p className="text-sm text-ink/50">Nothing waiting on review.</p>}
        </div>
      </section>

      <section className="rounded-lg border border-[var(--line)] p-5">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-ink/60">Mailbox Health</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink/60">
            <tr>
              <th className="py-2">Address</th>
              <th className="py-2">Provider</th>
              <th className="py-2">Status</th>
              <th className="py-2">Warmup</th>
              <th className="py-2 text-right">Sent Today</th>
              <th className="py-2 text-right">Daily Limit</th>
              <th className="py-2">Credentials</th>
            </tr>
          </thead>
          <tbody>
            {mailboxes.map((m) => (
              <tr key={m.id} className="border-t border-[var(--line)]">
                <td className="py-2">{m.address}</td>
                <td className="py-2">{m.provider}</td>
                <td className="py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      m.status === "ACTIVE" ? "bg-good/20 text-good" : "bg-bad/20 text-bad"
                    }`}
                  >
                    {m.status}
                  </span>
                </td>
                <td className="py-2">{m.warmupActive ? "Yes" : "No"}</td>
                <td className="tabular py-2 text-right">{m.sentToday}</td>
                <td className="tabular py-2 text-right">{m.dailyLimit}</td>
                <td className="py-2 text-xs text-ink/60">
                  {m.oauthConfigured || m.smtpConfigured ? "Configured" : "Not configured"}
                </td>
              </tr>
            ))}
            {mailboxes.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink/50">
                  No mailboxes configured yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-[var(--line)] p-5">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-ink/60">Send Calendar (Queued)</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink/60">
            <tr>
              <th className="py-2">Company</th>
              <th className="py-2">Step</th>
              <th className="py-2">Subject</th>
              <th className="py-2">Mailbox</th>
              <th className="py-2">Scheduled</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.map((u) => (
              <tr key={u.id} className="border-t border-[var(--line)]">
                <td className="py-2">
                  <Link href={`/leads/${u.lead.id}`} className="text-accent">
                    {u.lead.companyName}
                  </Link>
                </td>
                <td className="tabular py-2">#{u.sequenceStep}</td>
                <td className="py-2">{u.subject}</td>
                <td className="py-2">{u.account?.address ?? "—"}</td>
                <td className="py-2">{u.scheduledAt ? new Date(u.scheduledAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {upcoming.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink/50">
                  Nothing queued.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
