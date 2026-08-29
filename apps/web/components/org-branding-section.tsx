"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api-client";

interface Branding {
  emailOrgName: string;
  emailSenderName: string;
  postalAddress: string;
}

/**
 * What outreach emails actually say for {{org.name}} and {{sender.name}} —
 * and, via emailOrgName, what shows in the recipient's inbox as the From
 * name (see EmailProviderService.sendForLead). Before this existed those
 * placeholders went out to real prospects unresolved, literally as
 * "{{org.name}}", because nothing ever substituted them.
 */
export function OrgBrandingSection() {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [draft, setDraft] = useState<Branding>({ emailOrgName: "", emailSenderName: "", postalAddress: "" });
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
        Fills in <code>{"{{org.name}}"}</code> and <code>{"{{sender.name}}"}</code> in every outreach
        email. Company name is also what recipients see as the From display name in their inbox
        (unless a specific mailbox has its own name set in Settings &gt; Email accounts).
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

      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs text-ink/60">Company name (inbox From name + signature)</span>
          <input
            value={draft.emailOrgName}
            onChange={(e) => setDraft((d) => ({ ...d, emailOrgName: e.target.value }))}
            placeholder="e.g. EurosHub"
            className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink/60">Sender name (first line of the signature only)</span>
          <input
            value={draft.emailSenderName}
            onChange={(e) => setDraft((d) => ({ ...d, emailSenderName: e.target.value }))}
            placeholder="e.g. Team, or a person's name"
            className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
          />
        </label>
        <label className="block sm:col-span-2">
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
        <div className="sm:col-span-2">
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
