"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { useRealtimeEvent } from "../../lib/realtime";
import { Modal } from "../ui/modal";

interface WhatsAppQrAccount {
  id: string;
  username: string;
  displayName: string | null;
  externalAccountId: string | null;
  status: "CONNECTED" | "EXPIRED" | "DISCONNECTED" | "ERROR";
}

type SessionStatus = "CONNECTING" | "QR_PENDING" | "CONNECTED" | "DISCONNECTED" | "LOGGED_OUT";

function StatusBadge({ status }: { status: SessionStatus | WhatsAppQrAccount["status"] }) {
  const tone =
    status === "CONNECTED"
      ? "bg-good/15 text-good"
      : status === "LOGGED_OUT" || status === "ERROR"
        ? "bg-bad/15 text-bad"
        : "bg-ink/8 text-ink/50";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>{status.replace("_", " ")}</span>;
}

/**
 * QR connect modal -- scan once, the session manager keeps the socket alive
 * server-side from then on (Part: WhatsApp Team Inbox, 2026-10-26). No
 * OAuth redirect here at all: the backend pushes the QR image + connected
 * confirmation over the user's own realtime socket room
 * (RealtimeGateway.emitToUser), not the whole org, so only the person who
 * clicked "Connect" sees this number's QR code.
 */
function ConnectQrModal({ open, onOpenChange, onConnected }: { open: boolean; onOpenChange: (open: boolean) => void; onConnected: () => void }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setAccountId(null);
      setQrDataUrl(null);
      setConnected(false);
      setError(null);
      return;
    }
    api
      .startWhatsAppQrSession()
      .then((res) => setAccountId((res as { accountId: string }).accountId))
      .catch((err) => setError((err as Error).message));
  }, [open]);

  useRealtimeEvent<{ accountId: string; qrDataUrl: string }>("whatsappQr.qr", (payload) => {
    if (payload.accountId === accountId) setQrDataUrl(payload.qrDataUrl);
  });
  useRealtimeEvent<{ accountId: string }>("whatsappQr.connected", (payload) => {
    if (payload.accountId === accountId) {
      setConnected(true);
      onConnected();
    }
  });
  useRealtimeEvent<{ accountId: string }>("whatsappQr.disconnected", (payload) => {
    if (payload.accountId === accountId) setError("Connection attempt failed -- close this and try again.");
  });

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Connect a WhatsApp number">
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        {error && <p className="text-sm text-bad">{error}</p>}
        {!error && connected && <p className="text-sm font-medium text-good">Connected! The team can reply from the Inbox tab now.</p>}
        {!error && !connected && !qrDataUrl && <p className="text-sm text-ink/50">Generating QR code…</p>}
        {!error && !connected && qrDataUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, not something next/image can optimize */}
            <img src={qrDataUrl} alt="WhatsApp QR code" className="h-56 w-56 rounded-lg border border-[var(--line)]" />
            <p className="max-w-xs text-xs text-ink/50">
              Open WhatsApp on the phone whose number this is → Settings → Linked Devices → Link a Device, then scan this code. The phone keeps
              working normally afterward -- this just adds the team inbox as an extra linked device.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Numbers tab for the WhatsApp Team Inbox -- replaces PlatformAccountsList's
 *  OAuth-reconnect UI entirely, since there's no OAuth here at all (Part:
 *  WhatsApp Team Inbox, 2026-10-26). */
export function WhatsAppQrNumbersList() {
  const queryClient = useQueryClient();
  // Connect/reconnect/disconnect is primary-admin-only now, matching the
  // backend (Part: connect-accounts primary-admin-only, 2026-10-27,
  // explicit user request — "hide the adding or connecting accounts for
  // all the user except me"). Rename is left available to anyone with
  // Social Media access — it's not a connect/disconnect action and the
  // backend doesn't restrict it either.
  const meQuery = useQuery({
    queryKey: ["me-is-primary-admin"],
    queryFn: () => api.getMe() as Promise<{ isPrimaryAdmin: boolean }>,
  });
  const canManageAccounts = meQuery.data?.isPrimaryAdmin ?? false;
  const [modalOpen, setModalOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const accountsQuery = useQuery({
    queryKey: ["social-media-accounts"],
    queryFn: () => api.getSocialAccounts() as Promise<WhatsAppQrAccount[] & { platform: string }[]>,
  });
  const numbers = ((accountsQuery.data as unknown as (WhatsAppQrAccount & { platform: string })[]) ?? []).filter(
    (a) => a.platform === "WHATSAPP_QR",
  );

  function refetchAccounts() {
    queryClient.invalidateQueries({ queryKey: ["social-media-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["social-inbox-stats"] });
  }

  async function reconnect(accountId: string) {
    setBusyId(accountId);
    setActionError(null);
    try {
      await api.reconnectWhatsAppQrSession(accountId);
      setModalOpen(true);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function startRename(account: WhatsAppQrAccount) {
    setRenamingId(account.id);
    setRenameDraft(account.displayName || "");
  }

  async function confirmRename(accountId: string) {
    const displayName = renameDraft.trim();
    if (!displayName) {
      setRenamingId(null);
      return;
    }
    setBusyId(accountId);
    setActionError(null);
    try {
      await api.updateSocialAccountSettings(accountId, { displayName });
      refetchAccounts();
      setRenamingId(null);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function logout(accountId: string) {
    if (!window.confirm("Disconnect this number? The whole team loses access until it's reconnected and re-scanned.")) return;
    setBusyId(accountId);
    setActionError(null);
    try {
      await api.logoutWhatsAppQrSession(accountId);
      refetchAccounts();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">WhatsApp (Team) — Numbers</h1>
        {canManageAccounts && (
          <button
            type="button"
            className="flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
            onClick={() => setModalOpen(true)}
          >
            Connect new number
          </button>
        )}
      </div>

      {actionError && <p className="text-sm text-bad">{actionError}</p>}
      {accountsQuery.isLoading && <p className="text-sm text-ink/50">Loading…</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {numbers.map((n) => (
          <div key={n.id} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {renamingId === n.id ? (
                  <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      confirmRename(n.id);
                    }}
                  >
                    <input
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setRenamingId(null)}
                      className="w-full rounded-md border border-[var(--line)] bg-transparent px-2 py-1 text-sm"
                    />
                    <button type="submit" disabled={busyId === n.id} className="text-xs font-medium text-accent disabled:opacity-50">
                      Save
                    </button>
                    <button type="button" className="text-xs text-ink/50" onClick={() => setRenamingId(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button type="button" className="flex items-center gap-1.5 text-left" title="Rename" onClick={() => startRename(n)}>
                    <span className="text-sm font-semibold">{n.displayName || n.username}</span>
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-ink/40" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path d="M11 2l3 3-7.5 7.5L3 13l.5-3.5L11 2z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                {n.externalAccountId && <div className="text-xs text-ink/50">+{n.externalAccountId}</div>}
              </div>
              <StatusBadge status={n.status} />
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded-full bg-ink/[0.05] px-3 py-1 text-xs font-medium text-ink/60 transition-colors hover:bg-ink/10"
                onClick={() => startRename(n)}
              >
                Rename
              </button>
              {canManageAccounts && n.status !== "CONNECTED" && (
                <button
                  type="button"
                  className="rounded-full bg-ink/[0.05] px-3 py-1 text-xs font-medium text-ink/60 transition-colors hover:bg-ink/10 disabled:opacity-50"
                  disabled={busyId === n.id}
                  onClick={() => reconnect(n.id)}
                >
                  Reconnect (scan QR)
                </button>
              )}
              {canManageAccounts && (
                <button
                  type="button"
                  className="rounded-full bg-bad/10 px-3 py-1 text-xs font-medium text-bad transition-colors hover:bg-bad/20 disabled:opacity-50"
                  disabled={busyId === n.id}
                  onClick={() => logout(n.id)}
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        ))}
        {!accountsQuery.isLoading && numbers.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-ink/50">
            {canManageAccounts
              ? 'No WhatsApp numbers connected yet. Click "Connect new number" and scan the QR code with the phone that owns the number.'
              : "No WhatsApp numbers connected yet — ask your primary admin to connect one."}
          </p>
        )}
      </div>

      <ConnectQrModal open={modalOpen} onOpenChange={setModalOpen} onConnected={refetchAccounts} />
    </div>
  );
}
