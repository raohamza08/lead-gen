"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { SectionCard, DataTable } from "../../../../components/chart-kit";
import { Modal } from "../../../../components/ui/modal";
import { UpworkAgencyConnectionGate, UpworkConnectionStatus } from "../../../../components/upwork-agency-connection-gate";

interface Skill {
  id: string;
  ontologyId: string;
  preferredLabel: string;
  definition: string | null;
}

/** Ontology & Reference Data (spec Module F). Part: Upwork API
 *  integration — enterprise UI shell, 2026-10-23. Static reference
 *  taxonomy, cached 24h server-side, used to annotate other modules —
 *  shown here as a standalone browser, not mixed into operational
 *  dashboards. Error/empty states + click-through detail added as part
 *  of the CRM-functionality pass, 2026-10-23 — no category filter here:
 *  the real API response has no skill→category link, so filtering
 *  skills by category would be a fabricated control, not a real one. */
export default function OntologyPage() {
  const statusQuery = useQuery({ queryKey: ["upwork-api-status"], queryFn: () => api.getUpworkApiStatus() as Promise<UpworkConnectionStatus> });
  const connected = Boolean(statusQuery.data?.connected);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Skill | null>(null);

  const ontologyQuery = useQuery({ queryKey: ["upwork-api-ontology"], queryFn: () => api.getUpworkApiOntology(), enabled: connected });
  const ontology = ontologyQuery.data;

  if (statusQuery.isLoading) return <p className="text-sm text-ink/55">Loading…</p>;
  if (!connected) return <UpworkAgencyConnectionGate title="Ontology" />;

  const allSkills = ontology?.skills ?? [];
  const filteredSkills = allSkills.filter((s) => s.preferredLabel.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold tracking-tight">Ontology & Reference Data</h1>
      <p className="text-xs text-ink/50">Upwork&apos;s own skill/category taxonomy — a reference library, not agency-specific data. Click a skill for its full definition.</p>

      <SectionCard title="Categories">
        {ontologyQuery.isLoading && <p className="text-sm text-ink/55">Loading…</p>}
        {ontologyQuery.error && <p className="text-sm text-bad">{(ontologyQuery.error as Error).message}</p>}
        {ontology && ontology.categories.length === 0 && <p className="text-sm text-ink/55">No categories available.</p>}
        {ontology && ontology.categories.length > 0 && (
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
        <div className="mb-3 flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter skills…"
            className="h-9 w-full max-w-sm rounded-md border border-[var(--line)] bg-transparent px-2.5 text-sm"
          />
          {filter !== "" && (
            <button type="button" onClick={() => setFilter("")} className="text-xs text-accent hover:underline">
              Clear
            </button>
          )}
        </div>
        {ontologyQuery.error && <p className="text-sm text-bad">{(ontologyQuery.error as Error).message}</p>}
        {ontology && filteredSkills.length === 0 && (
          <p className="py-6 text-center text-sm text-ink/50">{filter ? "No skills match this filter." : "No skills available."}</p>
        )}
        {ontology && filteredSkills.length > 0 && (
          <div className="flex flex-col gap-2">
            {/* Only the first 100 matches are fetched into `rows` — sort below only orders those, not the full filtered set. */}
            <DataTable
              rowKey={(s) => s.id}
              onRowClick={(s) => setSelected(s)}
              columns={[
                { key: "label", header: "Skill", render: (s) => s.preferredLabel, sortValue: (s) => s.preferredLabel },
                { key: "ontologyId", header: "Ontology ID", render: (s) => s.ontologyId, sortValue: (s) => s.ontologyId },
              ]}
              rows={filteredSkills.slice(0, 100)}
            />
            {filteredSkills.length > 100 && (
              <p className="text-xs text-ink/40">Showing the first 100 of {filteredSkills.length} matching skills — narrow the filter to see more.</p>
            )}
          </div>
        )}
      </SectionCard>

      <Modal open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} variant="drawer-right" title={selected?.preferredLabel ?? "Skill"} contentClassName="w-full max-w-md">
        {selected && (
          <dl className="flex flex-col gap-3 text-xs">
            <div>
              <dt className="text-ink/50">Ontology ID</dt>
              <dd className="font-medium text-ink">{selected.ontologyId}</dd>
            </div>
            <div>
              <dt className="text-ink/50">Definition</dt>
              <dd className="mt-1 text-sm text-ink/80">{selected.definition ?? "No definition available."}</dd>
            </div>
          </dl>
        )}
      </Modal>
    </div>
  );
}
