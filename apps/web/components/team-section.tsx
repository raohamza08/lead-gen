"use client";

import { useEffect, useState } from "react";
import { api, getCurrentUser } from "../lib/api-client";
import { PersonAccessPanel } from "./person-access-panel";
import { Avatar } from "./avatar";
import { Modal } from "./ui/modal";

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role:
    | "ADMIN"
    | "MANAGER"
    | "LEAD_REVIEWER"
    | "SALES_REP"
    | "VIEWER"
    | "PROJECT_MANAGER"
    | "BUSINESS_DEVELOPER"
    | "EMAIL_REVIEWER"
    | "ADS_MANAGER"
    | "LEAD_GEN_MANAGER";
  active: boolean;
  createdAt: string;
  isPrimaryAdmin: boolean;
  displayName: string | null;
  avatarUrl: string | null;
}

const ROLES: TeamMember["role"][] = [
  "ADMIN",
  "MANAGER",
  "LEAD_REVIEWER",
  "SALES_REP",
  "VIEWER",
  "PROJECT_MANAGER",
  "BUSINESS_DEVELOPER",
  "EMAIL_REVIEWER",
  "ADS_MANAGER",
  "LEAD_GEN_MANAGER",
];

const EMPTY_DRAFT = { name: "", email: "", password: "", role: "SALES_REP" as TeamMember["role"] };

/**
 * Team / user management (Part A2/A4).
 *
 * The API already enforced all of this via RolesGuard — creating a user,
 * changing a role, deactivating an account are all @Roles(ADMIN)-gated on the
 * backend. What was missing was any UI to reach them at all, so every login
 * had to share the one seeded admin@example.com account.
 */
export function TeamSection() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [manageId, setManageId] = useState<string | null>(null);

  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.role === "ADMIN";
  // isPrimaryAdmin is deliberately absent from the JWT (it's a live,
  // instantly-revocable DB flag — see PrimaryAdminGuard) — read it off the
  // already-loaded members list instead of a second /users/me round trip.
  const isPrimaryAdmin = members.find((m) => m.id === currentUser?.sub)?.isPrimaryAdmin ?? false;

  function refresh() {
    api
      .getUsers()
      .then((res) => setMembers(res as TeamMember[]))
      .catch((err) => setError((err as Error).message));
  }

  useEffect(refresh, []);

  async function createMember(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created = (await api.createUser(draft)) as { credentialsEmailSent?: boolean };
      setNotice(
        created.credentialsEmailSent
          ? `${draft.email} was emailed their login link and password.`
          : `${draft.email} was created, but the credentials email could not be sent (no active mailbox?) — share the password with them directly.`,
      );
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(member: TeamMember, role: TeamMember["role"]) {
    setBusyId(member.id);
    setError(null);
    try {
      await api.changeUserRole(member.id, role);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function makePrimaryAdmin(member: TeamMember) {
    if (
      !window.confirm(
        `Make ${member.name} the primary administrator?\n\nThey will gain exclusive access to System Logs and security notifications — you will lose that access.`,
      )
    )
      return;
    setBusyId(member.id);
    setError(null);
    try {
      await api.transferPrimaryAdmin(member.id);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(member: TeamMember) {
    setBusyId(member.id);
    setError(null);
    try {
      if (member.active) {
        await api.deactivateUser(member.id);
      } else {
        await api.activateUser(member.id);
      }
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteMember(member: TeamMember) {
    if (
      !window.confirm(
        `Permanently delete ${member.name} (${member.email})?\n\nThis cannot be undone. Their leads, review notes and other history stay on record but are no longer attributed to them — this only removes their account and login access.`,
      )
    )
      return;
    setBusyId(member.id);
    setError(null);
    try {
      await api.deleteUser(member.id);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-xl border border-[var(--line)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Team</h2>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5"
          >
            {showForm ? "Cancel" : "New user"}
          </button>
        )}
      </div>

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

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink/55">
            <tr className="border-b border-[var(--line)]">
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Email</th>
              <th className="py-2 pr-3">Role</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isSelf = m.id === currentUser?.sub;
              return (
                <tr key={m.id} className="border-b border-[var(--line)] last:border-0">
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <Avatar name={m.displayName || m.name} email={m.email} avatarUrl={m.avatarUrl} sizeClass="h-6 w-6 text-[10px]" />
                      <span>
                        {m.name}
                        {isSelf ? <span className="text-ink/40"> (you)</span> : null}
                      </span>
                    </div>
                    {m.isPrimaryAdmin && (
                      <span
                        className="ml-1.5 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gold"
                        title="The organization's single authorized administrator — exclusive access to System Logs and security notifications."
                      >
                        Primary Admin
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-ink/60">{m.email}</td>
                  <td className="py-2 pr-3">
                    <span className="rounded bg-ink/8 px-2 py-0.5 text-xs text-ink/70">{m.role}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        m.active ? "bg-good/20 text-good" : "bg-bad/20 text-bad"
                      }`}
                    >
                      {m.active ? "Active" : "Deactivated"}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      {isAdmin && (
                        <button
                          onClick={() => setManageId(m.id)}
                          className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5"
                        >
                          Manage
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          disabled={busyId === m.id || isSelf || m.isPrimaryAdmin}
                          title={
                            isSelf
                              ? "You can't delete your own account."
                              : m.isPrimaryAdmin
                                ? "Transfer primary admin to someone else before deleting this account."
                                : undefined
                          }
                          onClick={() => deleteMember(m)}
                          className="rounded-md border border-[rgb(var(--bad-rgb)/0.4)] px-2.5 py-1 text-xs text-bad transition-colors hover:bg-[rgb(var(--bad-rgb)/0.08)] disabled:opacity-50"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {members.length === 0 && (
              <tr>
                <td colSpan={5} className="py-6 text-center text-sm text-ink/50">
                  No other team members yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && isAdmin && (
        <form onSubmit={createMember} className="mt-4 grid gap-3 border-t border-[var(--line)] pt-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Name *</span>
            <input
              required
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Email *</span>
            <input
              type="email"
              required
              value={draft.email}
              onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
              placeholder="them@theircompany.com"
              className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Temporary password *</span>
            <input
              type="text"
              required
              minLength={8}
              value={draft.password}
              onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
              placeholder="At least 8 characters — share it with them directly"
              className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-ink/60">Role</span>
            <select
              value={draft.role}
              onChange={(e) => setDraft((d) => ({ ...d, role: e.target.value as TeamMember["role"] }))}
              className="w-full rounded border border-[var(--line)] bg-transparent px-3 py-2 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={saving || !draft.name.trim() || !draft.email.trim() || draft.password.length < 8}
              className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create user"}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setShowForm(false);
              }}
              className="rounded-md border border-[var(--line)] px-4 py-2 text-sm text-ink/70"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {manageId && (() => {
        const m = members.find((x) => x.id === manageId);
        if (!m) return null;
        const isSelf = m.id === currentUser?.sub;
        return (
          <Modal open onOpenChange={(open) => { if (!open) setManageId(null); }} title={`Manage ${m.name}`} contentClassName="w-full max-w-lg">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <Avatar name={m.displayName || m.name} email={m.email} avatarUrl={m.avatarUrl} sizeClass="h-9 w-9 text-xs" />
                <div>
                  <div className="text-sm font-medium">{m.name}</div>
                  <div className="text-xs text-ink/55">{m.email}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] pt-3">
                <label className="flex items-center gap-2 text-xs text-ink/70">
                  Role
                  <select
                    value={m.role}
                    disabled={busyId === m.id || isSelf}
                    title={isSelf ? "You can't change your own role." : undefined}
                    onChange={(e) => changeRole(m, e.target.value as TeamMember["role"])}
                    className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs disabled:opacity-50"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </label>

                <button
                  disabled={busyId === m.id || isSelf}
                  title={isSelf ? "You can't deactivate your own account." : undefined}
                  onClick={() => toggleActive(m)}
                  className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                >
                  {m.active ? "Deactivate" : "Activate"}
                </button>

                {isPrimaryAdmin && !isSelf && m.role === "ADMIN" && !m.isPrimaryAdmin && (
                  <button
                    disabled={busyId === m.id}
                    onClick={() => makePrimaryAdmin(m)}
                    className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                  >
                    Make primary admin
                  </button>
                )}
              </div>

              <div className="border-t border-[var(--line)] pt-3">
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/55">Module &amp; account access</h4>
                <PersonAccessPanel userId={m.id} />
              </div>
            </div>
          </Modal>
        );
      })()}
    </section>
  );
}
