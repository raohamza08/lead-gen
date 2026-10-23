"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function activityBar(level: number | null): string {
  if (level == null) return "—";
  const blocks = Math.round((level / 100) * 10);
  return "█".repeat(Math.max(0, blocks)) + "░".repeat(Math.max(0, 10 - blocks));
}

/** Work Diary (Part: Upwork API integration — Agency Tools, 2026-10-23)
 *  — real per-contract activity levels, memos, and screenshot flags via
 *  `workDiaryContract`. Primary-admin only for now (see sidebar-nav.tsx).
 *  Deliberately does NOT attempt hourly totals/charges (`contractTimeReport`)
 *  — confirmed live BLOCKED by a missing team-level Upwork permission
 *  ("no access of any team(s) for [view_gds_hourly_data_from_client,
 *  view_gds_charges_data_from_client]"), same class of gap as the
 *  Timesheets domain's own disclosed block. */
export default function WorkDiaryPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);

  const contractsQuery = useQuery({
    queryKey: ["upwork-work-diary-contracts"],
    queryFn: () => api.listUpworkWorkDiaryContracts(),
    enabled: connected,
  });
  const contracts = contractsQuery.data ?? [];

  const [contractId, setContractId] = useState("");
  const [date, setDate] = useState(todayISO());

  useEffect(() => {
    if (!contractId && contracts.length > 0) setContractId(contracts[0].upworkContractId);
  }, [contracts, contractId]);

  const diaryQuery = useQuery({
    queryKey: ["upwork-work-diary", contractId, date],
    queryFn: () => api.getUpworkWorkDiary(contractId, date),
    enabled: connected && Boolean(contractId) && Boolean(date),
  });
  const diary = diaryQuery.data;
  const selectedContract = contracts.find((c) => c.upworkContractId === contractId);

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Work Diary" />;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Work Diary</h1>
      </div>

      <SectionCard title="Pick a contract and date">
        {contractsQuery.isLoading && <p className="text-sm text-ink/55">Loading contracts…</p>}
        {contracts.length === 0 && !contractsQuery.isLoading && <p className="text-sm text-ink/55">No synced contracts found yet.</p>}
        {contracts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={contractId}
              onChange={(e) => setContractId(e.target.value)}
              className="h-9 min-w-[18rem] flex-1 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
            >
              {contracts.map((c) => (
                <option key={c.upworkContractId} value={c.upworkContractId}>
                  {c.title ?? "Untitled"} — {c.freelancerName ?? "Unknown freelancer"}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
            />
          </div>
        )}
      </SectionCard>

      {contractId && (
        <SectionCard title={selectedContract ? `${selectedContract.title ?? "Contract"} — ${date}` : date}>
          {diaryQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
          {diaryQuery.error && <p className="text-sm text-bad">{(diaryQuery.error as Error).message}</p>}
          {diary && diary.workDiaryTimeCells.length === 0 && (
            <p className="text-sm text-ink/55">No tracked activity for this contract on this date.</p>
          )}
          {diary && diary.workDiaryTimeCells.length > 0 && (
            <div className="flex flex-col gap-2">
              {diary.workDiaryMetadata && <p className="text-xs text-ink/40">Timezone offset: {diary.workDiaryMetadata.timezoneOffset}s</p>}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-ink/50">
                      <th className="py-1.5 pr-3">Time</th>
                      <th className="py-1.5 pr-3">Activity</th>
                      <th className="py-1.5 pr-3">Memo</th>
                      <th className="py-1.5 pr-3">Screenshot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diary.workDiaryTimeCells.map((cell, i) => (
                      <tr key={i} className="border-t border-[var(--line)]">
                        <td className="py-1.5 pr-3 text-xs text-ink/60">{cell.cellDateTime?.displayValue ?? "—"}</td>
                        <td className="py-1.5 pr-3 font-mono text-xs text-ink/70">
                          {activityBar(cell.activityLevel)} {cell.activityLevel != null ? `${cell.activityLevel}%` : ""}
                        </td>
                        <td className="py-1.5 pr-3 text-xs text-ink/70">{cell.memo || cell.task?.description || "—"}</td>
                        <td className="py-1.5 pr-3">
                          {cell.hasScreenshot && cell.screenshotImageUrlMedium ? (
                            <a href={cell.screenshotImageUrlMedium} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                              View
                            </a>
                          ) : (
                            <span className="text-xs text-ink/40">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SectionCard>
      )}
    </div>
  );
}
