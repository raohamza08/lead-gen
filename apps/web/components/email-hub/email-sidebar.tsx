"use client";

import Link from "next/link";

/**
 * Unified Inbox's own "Inbox" second-level sidebar (Part: full UI redesign
 * per UI.md, 2026-10-23, explicit user request — a Lightshot screenshot of
 * Email Hub rebuilt in the spec's Views/Folder Pane pattern, Section 6.4).
 *
 * Every count is real. "Unread" and "Possible Leads" didn't have a
 * dedicated filter anywhere in the UI before this — both are real
 * backend-supported statuses (ListMessagesQuery's UNREAD/POSSIBLE_LEADS)
 * that this page's view switcher simply never routed to; wired up rather
 * than faked. "Accounts" isn't a message filter, it links to the real
 * mailbox-connections settings page. "Sent" is real (already existed as
 * a view). "Drafts"/"Archive"/"Trash" from the reference screenshot are
 * deliberately NOT included: this app's IMAP sync only ever reads the
 * INBOX and Sent mailboxes (EmailHubSyncWorker/ImapReaderProvider never
 * touch a Drafts/Archive/Trash folder), so there is no real data to back
 * them — adding them would mean building real multi-folder IMAP sync
 * first, not a UI change.
 */
export interface EmailSidebarCounts {
  total: number;
  unread: number;
  leads: number;
  possibleLeads: number;
  accounts: number;
}

function MailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
      <path d="m4.5 6.5 7.5 6 7.5-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DotMailIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="1.5" />
      <circle cx="18.5" cy="6" r="3.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function UserIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" strokeLinecap="round" />
    </svg>
  );
}
function QuestionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </svg>
  );
}
function PlugIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 18v3" strokeLinecap="round" />
    </svg>
  );
}
function SendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75}>
      <path d="M20.5 3.5 10.5 13.5M20.5 3.5 14 20.5l-3.5-7-7-3.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Row({
  label,
  count,
  icon,
  active,
  href,
  onClick,
}: {
  label: string;
  count?: number;
  icon?: React.ReactNode;
  active: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const className = `flex items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
    active ? "bg-[var(--selected-bg)] font-semibold text-ink" : "text-ink/65 hover:bg-ink/5"
  }`;
  const content = (
    <>
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      {typeof count === "number" && count > 0 && <span className="tabular rounded-full bg-ink/8 px-1.5 py-0.5 text-[10px] font-semibold text-accent">{count}</span>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  );
}

export function EmailSidebar({ counts, view, onViewChange }: { counts: EmailSidebarCounts; view: string | null; onViewChange: (v: string | null) => void }) {
  return (
    <div className="hidden w-[214px] shrink-0 flex-col gap-3 border-r border-[var(--line)] py-3 pr-3 lg:flex">
      <div>
        <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Favourites</h2>
        <div className="flex flex-col gap-0.5">
          <Row label="Unified Inbox" count={counts.total} icon={<MailIcon className="h-4 w-4" />} active={view === null} onClick={() => onViewChange(null)} />
          <Row label="Unread" count={counts.unread} icon={<DotMailIcon className="h-4 w-4" />} active={view === "unread"} onClick={() => onViewChange("unread")} />
          <Row label="Leads" count={counts.leads} icon={<UserIcon className="h-4 w-4" />} active={view === "leads"} onClick={() => onViewChange("leads")} />
          <Row
            label="Possible Leads"
            count={counts.possibleLeads}
            icon={<QuestionIcon className="h-4 w-4" />}
            active={view === "possible-leads"}
            onClick={() => onViewChange("possible-leads")}
          />
          <Row label="Accounts" count={counts.accounts} icon={<PlugIcon className="h-4 w-4" />} active={false} href="/settings/email-hub" />
        </div>
      </div>

      <div>
        <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Folders</h2>
        <div className="flex flex-col gap-0.5">
          <Row label="Sent" icon={<SendIcon className="h-4 w-4" />} active={view === "sent"} onClick={() => onViewChange("sent")} />
        </div>
      </div>
    </div>
  );
}
