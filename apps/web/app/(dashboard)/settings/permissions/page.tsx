"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, getCurrentUser } from "../../../../lib/api-client";
import { Avatar } from "../../../../components/avatar";
import { PersonAccessPanel } from "../../../../components/person-access-panel";

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

/**
 * Consolidated Permissions panel (Part: Consolidated Permissions panel,
 * 2026-10-26, explicit user request — "its kinda scattered now, i want a
 * panel where i can manage each and everything"). Primary-admin-only, same
 * as the data it reads/writes (`GET/PATCH /users/:id/access` are already
 * `@RequiresPrimaryAdmin()`-gated server-side) -- this page just gives
 * that existing, already-complete backend endpoint a real, dedicated,
 * discoverable home instead of a modal nested inside Team's own modal.
 *
 * List + detail layout: every user on the left, everything about whoever's
 * selected on the right -- role/active/primary-admin transfer (lifted out
 * of team-section.tsx's "Manage" modal) plus the full module/account
 * access grid (PersonAccessPanel, unchanged logic, now with presets and
 * the shared Checkbox component).
 */
function PermissionsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const currentUser = getCurrentUser();
  const selectedId = searchParams?.get("userId") ?? undefined;

  function refresh() {
    api
      .getUsers()
      .then((res) => setMembers(res as TeamMember[]))
      .catch((err) => setError((err as Error).message));
  }

  useEffect(refresh, []);

  const isPrimaryAdmin = members?.find((m) => m.id === currentUser?.sub)?.isPrimaryAdmin ?? false;

  function selectUser(id: string) {
    router.push(`/settings/permissions?userId=${id}`);
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

  async function toggleActive(member: TeamMember) {
    setBusyId(member.id);
    setError(null);
    try {
      await (member.active ? api.deactivateUser(member.id) : api.activateUser(member.id));
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
        `Make ${member.name} the primary administrator?\n\nThey will gain exclusive access to System Logs, security notifications, and this Permissions panel — you will lose that access.`,
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

  if (members && !isPrimaryAdmin) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold tracking-tight">Permissions</h1>
        <p className="text-sm text-ink/55">This panel is restricted to the organization&apos;s primary administrator.</p>
      </div>
    );
  }

  const filtered = (members ?? []).filter((m) => {
    const q = filter.trim().toLowerCase();
    return !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  });
  const selected = members?.find((m) => m.id === selectedId);
  const isSelf = selected?.id === currentUser?.sub;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Permissions</h1>
        <p className="text-sm text-ink/55">See every teammate, inspect their access, and grant or revoke anything in one place.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.06)] px-3 py-2 text-sm text-bad">{error}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        {/* Left — every user */}
        <div className="card flex flex-col overflow-hidden">
          <div className="border-b border-[var(--line)] p-2.5">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search people…"
              className="w-full rounded-md border border-[var(--line)] bg-transparent px-2.5 py-1.5 text-sm"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {!members && <p className="p-3 text-sm text-ink/50">Loading…</p>}
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => selectUser(m.id)}
                className={`flex w-full items-center gap-2.5 border-b border-[var(--line)] px-3 py-2.5 text-left transition-colors ${
                  m.id === selectedId ? "bg-primary/8" : "hover:bg-ink/[0.03]"
                }`}
              >
                <Avatar name={m.displayName || m.name} email={m.email} avatarUrl={m.avatarUrl} sizeClass="h-7 w-7 text-[10px]" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.name}</div>
                  <div className="truncate text-xs text-ink/50">{m.email}</div>
                </div>
                {!m.active && <span className="rounded bg-bad/15 px-1.5 py-0.5 text-[10px] text-bad">Off</span>}
              </button>
            ))}
            {members && filtered.length === 0 && <p className="p-3 text-sm text-ink/50">No matches.</p>}
          </div>
        </div>

        {/* Right — selected user's full access */}
        <div className="flex flex-col gap-4">
          {!selected ? (
            <div className="card flex h-full items-center justify-center p-8 text-sm text-ink/50">Select someone on the left to inspect their access.</div>
          ) : (
            <>
              <div className="card flex flex-wrap items-center gap-3 p-4">
                <Avatar name={selected.displayName || selected.name} email={selected.email} avatarUrl={selected.avatarUrl} sizeClass="h-9 w-9 text-xs" />
                <div className="mr-auto">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {selected.name}
                    {selected.isPrimaryAdmin && (
                      <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gold">
                        Primary Admin
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink/55">{selected.email}</div>
                </div>
                <label className="flex items-center gap-2 text-xs text-ink/70">
                  Role
                  <select
                    value={selected.role}
                    disabled={busyId === selected.id || isSelf}
                    title={isSelf ? "You can't change your own role." : undefined}
                    onChange={(e) => changeRole(selected, e.target.value as TeamMember["role"])}
                    className="rounded border border-[var(--line)] bg-transparent px-2 py-1 text-xs disabled:opacity-50"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={busyId === selected.id || isSelf}
                  title={isSelf ? "You can't deactivate your own account." : undefined}
                  onClick={() => toggleActive(selected)}
                  className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                >
                  {selected.active ? "Deactivate" : "Activate"}
                </button>
                {!isSelf && selected.role === "ADMIN" && !selected.isPrimaryAdmin && (
                  <button
                    disabled={busyId === selected.id}
                    onClick={() => makePrimaryAdmin(selected)}
                    className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5 disabled:opacity-50"
                  >
                    Make primary admin
                  </button>
                )}
              </div>

              <PersonAccessPanel userId={selected.id} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PermissionsPage() {
  return (
    <Suspense fallback={null}>
      <PermissionsPageContent />
    </Suspense>
  );
}
