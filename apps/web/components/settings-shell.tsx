"use client";

import { ReactNode, useState } from "react";

/**
 * Generic 3-column Settings shell (Part: full UI redesign per UI.md,
 * 2026-10-23, Section 6.8) — "Column 1 (~150px): category list... Column
 * 2 (~200px): sub-navigation list for the active category... Column 3
 * (remaining width): the actual settings content." Config-array driven
 * so a new settings page is just a new array entry, not a new component
 * (Section 9's own build note). Deliberately NOT a full-screen modal
 * overlay over the whole app shell — this app's settings pages are real
 * bookmarkable routes (/settings/*), not a single in-app overlay, so this
 * renders inline as the page's own content instead of covering the top
 * bar/rail; the column layout and selected-state language are the part
 * of the spec being matched here, not the "covers everything" overlay
 * mechanic, which would mean collapsing every settings route into one
 * page and breaking existing bookmarks/links for no visual benefit.
 */
export interface SettingsCategory {
  id: string;
  label: string;
  icon?: ReactNode;
  sections: { id: string; label: string; content: ReactNode }[];
}

export function SettingsShell({ title, categories }: { title: string; categories: SettingsCategory[] }) {
  const [categoryId, setCategoryId] = useState<string | undefined>(categories[0]?.id);
  const category = categories.find((c) => c.id === categoryId) ?? categories[0];
  const [sectionId, setSectionId] = useState<string | undefined>(category?.sections[0]?.id);
  const section = category?.sections.find((s) => s.id === sectionId) ?? category?.sections[0];

  function selectCategory(id: string) {
    setCategoryId(id);
    const next = categories.find((c) => c.id === id);
    setSectionId(next?.sections[0]?.id);
  }

  return (
    <div className="card grid min-h-[480px] grid-cols-1 overflow-hidden md:grid-cols-[150px_200px_1fr]">
      {/* Column 1: category list. */}
      <div className="border-b border-[var(--line)] p-2 md:border-b-0 md:border-r">
        <h2 className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
        <div className="flex flex-col gap-0.5">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => selectCategory(c.id)}
              className={`flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                c.id === category?.id ? "font-semibold text-accent" : "text-ink/70 hover:bg-ink/5"
              }`}
            >
              {c.icon}
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Column 2: sub-navigation for the active category — 2-3px solid
          blue left border on the selected row (Section 6.8's own reuse of
          the "left bar = active" language). */}
      <div className="border-b border-[var(--line)] p-2 md:border-b-0 md:border-r">
        <div className="flex flex-col gap-0.5">
          {category?.sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSectionId(s.id)}
              className={`relative rounded py-1.5 pl-3 pr-2 text-left text-sm transition-colors ${
                s.id === section?.id ? "bg-ink/[0.03] font-semibold text-ink" : "text-ink/65 hover:bg-ink/5"
              }`}
            >
              {s.id === section?.id && <span aria-hidden className="absolute left-0 top-0.5 bottom-0.5 w-[3px] rounded-r bg-accent" />}
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Column 3: the actual settings content. */}
      <div className="min-w-0 overflow-y-auto p-6">{section?.content}</div>
    </div>
  );
}
