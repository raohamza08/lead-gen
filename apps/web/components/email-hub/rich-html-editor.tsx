"use client";

import { useEffect, useRef, useState } from "react";

const COMMANDS: { command: string; label: string; icon: string; className?: string }[] = [
  { command: "bold", label: "Bold", icon: "B", className: "font-bold" },
  { command: "italic", label: "Italic", icon: "I", className: "italic" },
  { command: "underline", label: "Underline", icon: "U", className: "underline" },
  { command: "insertUnorderedList", label: "Bullet list", icon: "•" },
  { command: "insertOrderedList", label: "Numbered list", icon: "1." },
];

/**
 * A minimal WYSIWYG body editor for compose/reply — contentEditable +
 * document.execCommand rather than a rich-text library, since the
 * formatting surface needed here (bold/italic/underline/lists/link) is
 * small and execCommand still works across every browser this app targets.
 * If formatting needs ever grow past this, that's the point to reach for a
 * real editor (TipTap/Lexical) instead of layering more execCommand calls.
 *
 * Deliberately uncontrolled: `initialHtml` seeds the DOM once on mount only
 * (a controlled contentEditable that re-syncs innerHTML from props on every
 * keystroke resets the caret position to the start on every character
 * typed). Pass a different `key` from the parent to reset it for a new
 * message rather than expecting prop changes to update the content.
 */
export function RichHtmlEditor({
  initialHtml = "",
  onChange,
  placeholder,
  autoFocus,
}: {
  initialHtml?: string;
  onChange: (html: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const savedRangeRef = useRef<Range | null>(null);

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml;
    if (autoFocus) editorRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exec(command: string) {
    editorRef.current?.focus();
    document.execCommand(command);
    onChange(editorRef.current?.innerHTML ?? "");
  }

  function openLinkInput() {
    const selection = window.getSelection();
    savedRangeRef.current = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    setLinkUrl("");
    setShowLinkInput(true);
  }

  function confirmLink() {
    const url = linkUrl.trim();
    setShowLinkInput(false);
    if (!url) return;
    editorRef.current?.focus();
    const selection = window.getSelection();
    if (selection && savedRangeRef.current) {
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);
    }
    document.execCommand("createLink", false, /^https?:\/\//i.test(url) ? url : `https://${url}`);
    onChange(editorRef.current?.innerHTML ?? "");
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--paper)] focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[var(--line)] bg-ink/[0.03] px-1.5 py-1">
        {COMMANDS.map((c) => (
          <button
            key={c.command}
            type="button"
            title={c.label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(c.command)}
            className={`flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs text-ink/70 hover:bg-ink/10 ${c.className ?? ""}`}
          >
            {c.icon}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-[var(--line)]" />
        <button
          type="button"
          title="Add link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openLinkInput}
          className="flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs text-ink/70 hover:bg-ink/10"
        >
          🔗
        </button>
        <button
          type="button"
          title="Clear formatting"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("removeFormat")}
          className="flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs text-ink/70 hover:bg-ink/10"
        >
          ✕
        </button>
        {showLinkInput && (
          <div className="ml-1 flex min-w-0 flex-1 items-center gap-1">
            <input
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmLink();
                }
                if (e.key === "Escape") setShowLinkInput(false);
              }}
              placeholder="https://…"
              className="min-w-0 flex-1 rounded border border-[var(--line)] bg-[var(--paper)] px-2 py-1 text-xs"
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={confirmLink}
              className="shrink-0 rounded bg-accent px-2 py-1 text-[11px] font-medium text-white"
            >
              Add
            </button>
          </div>
        )}
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(editorRef.current?.innerHTML ?? "")}
        data-placeholder={placeholder}
        className="min-h-[140px] max-h-80 overflow-y-auto px-3 py-2.5 text-sm leading-relaxed outline-none empty:before:text-ink/35 empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}
