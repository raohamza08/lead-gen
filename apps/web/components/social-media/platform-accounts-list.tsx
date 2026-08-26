"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api-client";

interface Account {
  id: string;
  platform: string;
  username: string;
  displayName: string | null;
  status: "CONNECTED" | "EXPIRED" | "DISCONNECTED" | "ERROR";
  connected: boolean;
  lastPublishError: string | null;
}

function StatusBadge({ status }: { status: Account["status"] }) {
  const tone =
    status === "CONNECTED" ? "bg-good/15 text-good" : status === "EXPIRED" || status === "ERROR" ? "bg-bad/15 text-bad" : "bg-ink/8 text-ink/50";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>{status}</span>;
}

/** Reused by each per-platform page (LinkedIn/Instagram/Facebook/X) — same
 *  card list, just filtered to one platform, so opening a module shows
 *  exactly the accounts connected for that platform (Part: Social Media
 *  Hub) rather than the flat all-platforms list on /social-media/accounts. */
export function PlatformAccountsList({ platform, label }: { platform: string; label: string }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSocialAccounts()
      .then((res) => setAccounts((res as Account[]).filter((a) => a.platform === platform)))
      .catch((err) => setError((err as Error).message));
  }, [platform]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{label}</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Accounts connected for {label}. Connect more from{" "}
          <Link href="/social-media/accounts" className="text-accent hover:underline">
            Accounts
          </Link>
          .
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}

      {!error && !accounts && <p className="text-sm text-ink/50">Loading…</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accounts?.map((a) => (
          <Link key={a.id} href={`/social-media/accounts/${a.id}`} className="card card-interactive p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{a.displayName || a.username}</div>
                {a.displayName && <div className="text-xs text-ink/50">{a.username}</div>}
              </div>
              <StatusBadge status={a.status} />
            </div>
            {a.lastPublishError && (
              <p className="mt-2 text-xs text-bad" title={a.lastPublishError}>
                {a.lastPublishError.length > 90 ? `${a.lastPublishError.slice(0, 90)}…` : a.lastPublishError}
              </p>
            )}
          </Link>
        ))}
        {accounts && accounts.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-ink/50">
            No {label} accounts connected yet.{" "}
            <Link href="/social-media/accounts" className="text-accent hover:underline">
              Connect one
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
