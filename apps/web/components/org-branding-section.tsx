"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api-client";

interface Branding {
  emailOrgName: string;
  emailFromName: string;
  emailSenderName: string;
  postalAddress: string;
}

const EMPTY_BRANDING: Branding = { emailOrgName: "", emailFromName: "", emailSenderName: "", postalAddress: "" };

/**
 * Three independently-settable names for outreach email (Part: 3 separate
 * name fields — emailFromName was split out from emailOrgName so the inbox
 * identity doesn't have to match either signature line):
 *  - emailFromName: the inbox "From" display name recipients see.
 *  - emailSenderName: {{sender.name}}, the signature's first line.
 *  - emailOrgName: {{org.name}}, the signature's second line.
 * See EmailProviderService.sendForLead for exactly where each resolves.
 * Before emailOrgName/emailSenderName existed at all, those placeholders
 * went out to real prospects unresolved, literally as "{{org.name}}".
 */
export function OrgBrandingSection() {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [draft, setDraft] = useState<Branding>(EMPTY_BRANDING);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .getOrgBranding()
      .then((res) => {
        setBranding(res as Branding);
        setDraft(res as Branding);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = (await api.updateOrgBranding({ ...draft })) as Branding;
      setBranding(updated);
      setDraft(updated);
      setNotice("Saved. New outreach emails will use this from now on.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!branding) return null;

  return (
    <section className="rounded-xl border border-[var(--line)] p-5">
      <h2 className="mb-1 text-sm font-semibold tracking-tight">Email branding</h2>
      <p className="mb-4 text-xs text-ink/50">
        Three independent names for outreach email — set each on its own, they don&apos;t have to match.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-3 rounded-lg border border-[rgb(var(--good-rgb)/0.4)] bg-[rgb(var(--good-rgb)/0.06)] px-3 py-2 text-sm text-good">
          {notice}
        </div>
      )}

      <form onSubmit={save} className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs text-ink/60">Inbox &quot;From&quot; name</span>
          <input
            value={draft.emailFromName}
            onChange={(e) => setDraft((d) => ({ ...d, emailFromName: e.target.value }))}
            placeholder="e.g. EurosHub"
            className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-ink/40">
            What recipients see next to the mailbox address in their inbox. A specific mailbox&apos;s
            own display name (Settings &gt; Email accounts) overrides this.
          </p>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink/60">Signature — sender name</span>
          <input
            value={draft.emailSenderName}
            onChange={(e) => setDraft((d) => ({ ...d, emailSenderName: e.target.value }))}
            placeholder="e.g. Team, or a person's name"
            className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-ink/40">First line of the email signature.</p>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink/60">Signature — company name</span>
          <input
            value={draft.emailOrgName}
            onChange={(e) => setDraft((d) => ({ ...d, emailOrgName: e.target.value }))}
            placeholder="e.g. EurosHub"
            className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          />
          <p className="mt-1 text-[11px] text-ink/40">Second line of the email signature.</p>
        </label>
        <label className="block sm:col-span-3">
          <span className="mb-1 block text-xs text-ink/60">
            Postal address (signature — required by CAN-SPAM for commercial email)
          </span>
          <input
            value={draft.postalAddress}
            onChange={(e) => setDraft((d) => ({ ...d, postalAddress: e.target.value }))}
            placeholder="e.g. 123 Main St, Suite 400, Austin, TX 78701"
            className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          />
          {!draft.postalAddress && (
            <span className="mt-1 block text-[11px] text-gold">
              Not set — the footer&apos;s address line will be left blank on outreach emails until
              you add one here.
            </span>
          )}
        </label>
        <div className="sm:col-span-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save branding"}
          </button>
        </div>
      </form>
    </section>
  );
}
