"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, DataTable } from "../../../../components/chart-kit";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

/** Ontology & Reference Data (spec Module F). Part: Upwork API
 *  integration — enterprise UI shell, 2026-10-23. Static reference
 *  taxonomy, cached 24h server-side, used to annotate other modules —
 *  shown here as a standalone browser, not mixed into operational
 *  dashboards. */
export default function OntologyPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);
  const [filter, setFilter] = useState("");

  const ontologyQuery = useQuery({ queryKey: ["upwork-api-ontology"], queryFn: () => api.getUpworkApiOntology(), enabled: connected });
  const ontology = ontologyQuery.data;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Ontology" />;

  const filteredSkills = ontology?.skills.filter((s) => s.preferredLabel.toLowerCase().includes(filter.toLowerCase())) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Ontology & Reference Data</h1>
      <p className="text-xs text-ink/50">Upwork's own skill/category taxonomy — a reference library, not agency-specific data.</p>

      <SectionCard title="Categories">
        {ontologyQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {ontology && (
          <div className="flex flex-wrap gap-2">
            {ontology.categories.map((c) => (
              <span key={c.id} className="rounded-full bg-ink/8 px-3 py-1 text-xs text-ink/70">
                {c.preferredLabel}
              </span>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Skills">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter skills…"
          className="mb-3 h-9 w-full max-w-sm rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
        />
        {ontology && (
          <DataTable
            rowKey={(s) => s.id}
            columns={[
              { key: "label", header: "Skill", render: (s) => s.preferredLabel },
              { key: "ontologyId", header: "Ontology ID", render: (s) => s.ontologyId },
            ]}
            rows={filteredSkills.slice(0, 100)}
          />
        )}
      </SectionCard>
    </div>
  );
}
