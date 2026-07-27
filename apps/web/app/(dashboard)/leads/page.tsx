"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../../lib/api-client";
import type { Lead, LeadScore } from "@leadgen/types";

interface LeadRow extends Lead {
  score: LeadScore | null;
  pipelineState: { stage: string } | null;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLeads()
      .then((res: any) => setLeads(res.items))
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <p className="text-bad">{error}</p>;

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--line)]">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-ink/60">
          <tr>
            <th className="px-4 py-3">Company</th>
            <th className="px-4 py-3">Industry</th>
            <th className="px-4 py-3">Country</th>
            <th className="px-4 py-3 text-right">Lead Score</th>
            <th className="px-4 py-3">Stage</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id} className="border-b border-[var(--line)] last:border-0 hover:bg-black/5">
              <td className="px-4 py-3">
                <Link href={`/leads/${lead.id}`} className="font-medium text-accent">
                  {lead.companyName}
                </Link>
              </td>
              <td className="px-4 py-3">{lead.industry ?? "—"}</td>
              <td className="px-4 py-3">{lead.country ?? "—"}</td>
              <td className="tabular px-4 py-3 text-right">{lead.score?.leadScore ?? "—"}</td>
              <td className="px-4 py-3">
                <span className="rounded bg-black/5 px-2 py-0.5 text-xs">{lead.pipelineState?.stage ?? "—"}</span>
              </td>
            </tr>
          ))}
          {leads.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-8 text-center text-ink/50">
                No leads yet — configure a niche filter in Settings and run an extraction.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
