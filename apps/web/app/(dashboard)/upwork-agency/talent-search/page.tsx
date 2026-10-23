"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";
import { initials } from "../../../../components/upwork-room-conversation";

/** Talent Search (Part: Upwork API integration — Agency Tools, 2026-10-23)
 *  — real public freelancer search via `freelancerProfileSearchRecords`.
 *  Primary-admin only for now (see sidebar-nav.tsx) — "keep it to me for
 *  now, I'll see later whom to give access". Only `shortName` (Upwork's
 *  own "First L." privacy-truncated display name, same convention as its
 *  public UI) and `ciphertext` (the real profile URL slug) are available
 *  through this query — confirmed live, every richer field (skills, rate,
 *  location) resolved to null for every result tested, disclosed below
 *  rather than hidden. */
export default function TalentSearchPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const [keyword, setKeyword] = useState("");
  const [submitted, setSubmitted] = useState("");

  const searchQuery = useQuery({
    queryKey: ["upwork-talent-search", submitted],
    queryFn: () => api.searchUpworkTalent(submitted),
    enabled: connected && submitted.length > 0,
  });
  const data = searchQuery.data;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Talent Search" />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Talent Search</h1>
        <p className="mt-0.5 text-xs text-ink/50">
          Real public freelancer search, direct from Upwork. Only a privacy-truncated display name and profile link are available through this
          query — skills, rate, and location aren&apos;t exposed here.
        </p>
      </div>

      <SectionCard title="Search">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(keyword.trim());
          }}
        >
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="e.g. react developer, graphic designer…"
            className="h-9 flex-1 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
          />
          <button type="submit" disabled={!keyword.trim()} className="h-9 shrink-0 rounded-md bg-accent px-4 text-sm text-white disabled:opacity-50">
            Search
          </button>
        </form>
      </SectionCard>

      {submitted && (
        <SectionCard title={data ? `Results (${data.totalCount.toLocaleString()} total, showing ${data.results.length})` : "Results"}>
          {searchQuery.isLoading && <p className="text-sm text-ink/55">Searching…</p>}
          {searchQuery.error && <p className="text-sm text-bad">{(searchQuery.error as Error).message}</p>}
          {data && data.results.length === 0 && <p className="text-sm text-ink/55">No freelancers matched this search.</p>}
          {data && data.results.length > 0 && (
            <div className="flex flex-col gap-1">
              {data.results.map((r, i) => (
                <a
                  key={`${r.ciphertext}-${i}`}
                  href={r.ciphertext ? `https://www.upwork.com/freelancers/${r.ciphertext}` : "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-ink/[0.04]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                    {initials(r.shortName)}
                  </span>
                  <span className="text-sm font-medium text-ink">{r.shortName ?? "Unnamed freelancer"}</span>
                  <span className="ml-auto text-xs text-accent">View on Upwork →</span>
                </a>
              ))}
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
