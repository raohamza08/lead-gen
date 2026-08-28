"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api-client";
import { LoadingRow, Spinner } from "../../../components/spinner";

interface PendingApproval {
  id: string;
  subject: string;
  bodyHtml: string;
  status: "PENDING_APPROVAL" | "FAILED";
  failureReason: string | null;
  rationale: {
    hook?: string; insight?: string; evidence?: string | null; reframe?: string; cta?: string;
    reviewNotes?: string[];
  } | null;
  lead: { id: string; companyName: string; contactName: string | null; email: string | null };
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
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const approvalsQuery = useQuery({
    queryKey: ["sequences-approvals"],
    queryFn: () => api.getPendingApprovals() as Promise<PendingApproval[]>,
  });
  const mailboxesQuery = useQuery({
    queryKey: ["sequences-mailboxes"],
    queryFn: () => api.getEmailAccountsHealth() as Promise<MailboxHealth[]>,
  });

  const approvals = approvalsQuery.data ?? [];
  const failedCount = approvals.filter((a) => a.status === "FAILED").length;
  const mailboxes = mailboxesQuery.data ?? [];
  const isLoading = approvalsQuery.isLoading || mailboxesQuery.isLoading;
  const isFetching = approvalsQuery.isFetching || mailboxesQuery.isFetching;

  const actMutation = useMutation({
    mutationFn: ({ leadId, emailMessageId, action }: { leadId: string; emailMessageId: string; action: "APPROVE" | "REJECT" }) =>
      api.approveEmail(leadId, { emailMessageId, action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sequences-approvals"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const resendMutation = useMutation({
    mutationFn: ({ leadId, emailMessageId }: { leadId: string; emailMessageId: string }) => api.resendEmail(leadId, emailMessageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sequences-approvals"] });
    },
    onError: (err) => setError((err as Error).message),
  });

  const resendAllMutation = useMutation({
    mutationFn: () => api.resendAllFailedSequenceEmails() as Promise<{ attempted: number; sent: number }>,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["sequences-approvals"] });
      setError(
        result.sent < result.attempted
          ? `Resent ${result.sent} of ${result.attempted} — the rest failed again, check their reasons below.`
          : null,
      );
    },
    onError: (err) => setError((err as Error).message),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        {isFetching && !isLoading && <Spinner className="h-3.5 w-3.5" />}
      </div>
      {(error || approvalsQuery.error || mailboxesQuery.error) && (
        <p className="text-sm text-bad">
          {error ?? ((approvalsQuery.error ?? mailboxesQuery.error) as Error).message}
        </p>
      )}

      {isLoading ? (
        <LoadingRow label="Loading sequences…" />
      ) : (
      <>
      <section className="rounded-lg border border-[var(--line)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide text-ink/60">
            Approvals &amp; Failed Sends ({approvals.length})
          </h2>
          {failedCount > 0 && (
            <button
              disabled={resendAllMutation.isPending}
              onClick={() => resendAllMutation.mutate()}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {resendAllMutation.isPending ? "Resending…" : `Resend all failed (${failedCount})`}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3">
          {approvals.map((a) => (
            <div key={a.id} className="rounded border border-[var(--line)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Link href={`/leads/${a.lead.id}`} className="font-medium text-accent">
                      {a.lead.companyName}
                    </Link>
                    {a.status === "FAILED" && (
                      <span className="rounded bg-bad/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-bad">Failed</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-medium">{a.subject}</p>
                  {a.status === "FAILED" && a.failureReason && (
                    <p className="mt-1 rounded bg-bad/10 px-2 py-1 text-xs text-bad">Why it failed: {a.failureReason}</p>
                  )}
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
                  {a.status === "FAILED" ? (
                    <button
                      disabled={resendMutation.isPending}
                      onClick={() => resendMutation.mutate({ leadId: a.lead.id, emailMessageId: a.id })}
                      className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Resend
                    </button>
                  ) : (
                    <>
                      <button
                        disabled={actMutation.isPending}
                        onClick={() => actMutation.mutate({ leadId: a.lead.id, emailMessageId: a.id, action: "APPROVE" })}
                        className="rounded bg-good px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        disabled={actMutation.isPending}
                        onClick={() => actMutation.mutate({ leadId: a.lead.id, emailMessageId: a.id, action: "REJECT" })}
                        className="rounded bg-bad px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {approvals.length === 0 && <p className="text-sm text-ink/50">Nothing waiting on review or failed.</p>}
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

      </>
      )}
    </div>
  );
}
