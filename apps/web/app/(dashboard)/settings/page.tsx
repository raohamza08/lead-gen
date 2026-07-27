"use client";

import { useEffect, useState } from "react";
import { api } from "../../../lib/api-client";
import type { NicheFilter } from "@leadgen/types";

export default function SettingsPage() {
  const [filters, setFilters] = useState<NicheFilter[]>([]);
  const [niche, setNiche] = useState("");
  const [dailyTarget, setDailyTarget] = useState(100);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    api
      .getNicheFilters()
      .then((res) => setFilters(res as NicheFilter[]))
      .catch((err) => setError((err as Error).message));
  }

  useEffect(refresh, []);

  async function createFilter(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.createNicheFilter({ niche, dailyTarget, scheduleCron: "0 6 * * *", timezone: "UTC" });
      setNiche("");
      refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-[var(--line)] p-5">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-ink/60">Niche Filters</h2>
        {error && <p className="mb-3 text-sm text-bad">{error}</p>}
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink/60">
            <tr>
              <th className="py-2">Niche</th>
              <th className="py-2">Daily Target</th>
              <th className="py-2">Schedule</th>
              <th className="py-2">Active</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {filters.map((f) => (
              <tr key={f.id} className="border-t border-[var(--line)]">
                <td className="py-2">{f.niche}</td>
                <td className="tabular py-2">{f.dailyTarget}</td>
                <td className="py-2">
                  {f.scheduleCron} ({f.timezone})
                </td>
                <td className="py-2">{f.active ? "Yes" : "No"}</td>
                <td className="py-2">
                  <button
                    onClick={() => api.runNicheFilterNow(f.id)}
                    className="rounded bg-accent px-2 py-1 text-xs text-white"
                  >
                    Run now
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-[var(--line)] p-5">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wide text-ink/60">New Niche Filter</h2>
        <form onSubmit={createFilter} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-ink/60">Niche</label>
            <input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              required
              className="rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-ink/60">Daily target</label>
            <input
              type="number"
              value={dailyTarget}
              onChange={(e) => setDailyTarget(Number(e.target.value))}
              className="w-28 rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </div>
          <button type="submit" className="rounded bg-accent px-3 py-2 text-sm text-white">
            Create
          </button>
        </form>
      </section>
    </div>
  );
}
