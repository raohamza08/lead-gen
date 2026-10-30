"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, getCurrentUser } from "../../../../lib/api-client";
import { emitRealtimeEvent, useRealtimeEvent } from "../../../../lib/realtime";
import { Button } from "../../../../components/ui/button";

type SessionStatus = "LOGGED_OUT" | "AWAITING_LOGIN" | "ACTIVE";

interface Holder {
  userId: string;
  userName: string;
  claimedAt: string;
}

interface Account {
  id: string;
  label: string;
  status: SessionStatus;
  isResident: boolean;
  holder: Holder | null;
  lastHolderName: string | null;
  lastActiveAt: string | null;
}

/**
 * Remote-controls the shared, persistent, server-side LinkedIn browser
 * sessions (Part: LinkedIn Outreach, shared-session shift handoff — explicit
 * user request: three office shifts, one person on duty at a time, log in
 * once instead of every shift re-authenticating; extended 2026-10-30 to
 * support multiple connected accounts side by side, also on explicit
 * request). Each account in the switcher below is its own real server-side
 * Chromium tab (JPEG frames pushed over the socket) — mouse/keyboard
 * captured on the canvas are forwarded the same way, so whoever holds the
 * claim on an account is genuinely driving that one browser, not a copy of
 * it. No LinkedIn credentials ever pass through this app's own code: the
 * first login (and any 2FA) for each account is typed by a real person
 * straight into the live view, same as sitting at a remote desktop.
 */
export default function LinkedinOutreachPage() {
  const myUserId = getCurrentUser()?.sub;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPrimaryAdmin, setIsPrimaryAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;
  const isHolder = Boolean(selected?.holder && myUserId && selected.holder.userId === myUserId);

  useEffect(() => {
    imageRef.current = new window.Image();
  }, []);

  const loadAccounts = useCallback(() => {
    api
      .listLinkedinOutreachAccounts()
      .then((res) => {
        const list = res as Account[];
        setAccounts(list);
        setSelectedId((prev) => prev ?? list[0]?.id ?? null);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    loadAccounts();
    api
      .getMe()
      .then((me) => setIsPrimaryAdmin(Boolean((me as { isPrimaryAdmin?: boolean }).isPrimaryAdmin)))
      .catch(() => undefined);
  }, [loadAccounts]);

  useRealtimeEvent<{ accountId: string; status: SessionStatus }>("linkedinSession.status", ({ accountId, status }) =>
    setAccounts((prev) => prev.map((a) => (a.id === accountId ? { ...a, status } : a))),
  );
  useRealtimeEvent<{ accountId: string; holder: Holder | null }>("linkedinSession.lock", ({ accountId, holder }) =>
    setAccounts((prev) => prev.map((a) => (a.id === accountId ? { ...a, holder } : a))),
  );
  useRealtimeEvent<{ accountId: string; by: string }>("linkedinSession.kicked", ({ accountId, by }) => {
    const name = accounts.find((a) => a.id === accountId)?.label ?? "An account";
    setNotice(`${by} took over "${name}".`);
  });
  useRealtimeEvent<{ accountId: string }>("linkedinSession.removed", ({ accountId }) => {
    setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    setSelectedId((prev) => (prev === accountId ? null : prev));
  });
  useRealtimeEvent<{ accountId: string; data: string }>("linkedinSession.frame", ({ accountId, data }) => {
    if (accountId !== selectedId) return;
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    img.onload = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (canvas.width !== img.width) canvas.width = img.width;
      if (canvas.height !== img.height) canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${data}`;
  });

  function patchAccount(id: string, patch: Partial<Account>) {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  async function runAction(id: string, action: (accountId: string) => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await action(id);
      const r = res as { status?: SessionStatus; holder?: Holder | null };
      const patch: Partial<Account> = {};
      if (r.status) patch.status = r.status;
      if (r.holder !== undefined) patch.holder = r.holder;
      if (Object.keys(patch).length) patchAccount(id, patch);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddAccount() {
    const label = window.prompt("Name this LinkedIn account (e.g. \"Company Page\", \"Jane — Sales\"):");
    if (!label || !label.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const account = (await api.addLinkedinOutreachAccount(label.trim())) as Account;
      setAccounts((prev) => [...prev, account]);
      setSelectedId(account.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveAccount(account: Account) {
    if (!window.confirm(`Remove "${account.label}"? This wipes its LinkedIn session completely — it can only come back by adding it again and logging in from scratch.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.removeLinkedinOutreachAccount(account.id);
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      setSelectedId((prev) => (prev === account.id ? null : prev));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function localCoords(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width || 1;
    const scaleY = canvas.height / rect.height || 1;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  const sendInput = useCallback(
    (payload: Record<string, unknown>) => {
      if (!selectedId) return;
      emitRealtimeEvent("linkedinSession.input", { accountId: selectedId, ...payload });
    },
    [selectedId],
  );

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isHolder) return;
    sendInput({ type: "mouseMove", ...localCoords(e) });
  }
  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isHolder) return;
    sendInput({ type: "mousePressed", ...localCoords(e), button: e.button === 2 ? "right" : "left" });
  }
  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isHolder) return;
    sendInput({ type: "mouseReleased", ...localCoords(e), button: e.button === 2 ? "right" : "left" });
  }
  // A key that types a literal character (letters, digits, punctuation,
  // space) needs to go through CDP's Input.insertText, not a bare
  // Input.dispatchKeyEvent — Chrome's keyDown/keyUp alone don't produce any
  // text in a focused field without an accompanying "char" event, which is
  // what insertText drives server-side (Part: LinkedIn Outreach, 2026-10-30
  // bug fix, explicit user report — "not able to click or write"). Control
  // keys (Backspace, Enter, Tab, arrows, Escape, and any Ctrl/Alt/Meta
  // combo) still go through keyDown/keyUp so the page's own JS keyboard
  // handlers see them as real key presses.
  function isPrintableKey(e: React.KeyboardEvent<HTMLCanvasElement>): boolean {
    return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!isHolder) return;
    e.preventDefault();
    if (isPrintableKey(e)) {
      sendInput({ type: "insertText", text: e.key });
      return;
    }
    sendInput({ type: "keyDown", key: e.key, code: e.code });
  }
  function handleKeyUp(e: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!isHolder) return;
    e.preventDefault();
    if (isPrintableKey(e)) return;
    sendInput({ type: "keyUp", key: e.key, code: e.code });
  }

  const statusLabel = (status: SessionStatus | undefined) =>
    status === "ACTIVE" ? "Logged in" : status === "AWAITING_LOGIN" ? "Needs login" : status === "LOGGED_OUT" ? "Logged out" : "Checking…";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">LinkedIn Outreach</h1>
          <p className="text-sm text-ink/60">Connect and drive one or more shared LinkedIn accounts — one person at a time per account.</p>
        </div>
        <Button onClick={handleAddAccount} loading={busy}>
          + Add account
        </Button>
      </div>

      {error && <div className="rounded-lg border border-[rgb(var(--bad-rgb)/0.4)] bg-[rgb(var(--bad-rgb)/0.08)] px-3 py-2 text-sm text-error">{error}</div>}
      {notice && (
        <div className="rounded-lg border border-[var(--line)] bg-ink/5 px-3 py-2 text-sm text-ink/75">
          {notice}{" "}
          <button className="underline" onClick={() => setNotice(null)}>
            dismiss
          </button>
        </div>
      )}

      {accounts.length === 0 && (
        <p className="rounded-lg border border-dashed border-[var(--line)] px-4 py-6 text-center text-sm text-ink/50">
          No LinkedIn accounts connected yet — add one to get started.
        </p>
      )}

      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-[var(--line)] pb-2">
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedId(a.id)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                a.id === selectedId ? "border-accent bg-accent/10 text-accent" : "border-[var(--line)] text-ink/70 hover:bg-ink/5"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  a.status === "ACTIVE" ? "bg-[rgb(var(--good-rgb))]" : a.status === "AWAITING_LOGIN" ? "bg-[rgb(var(--gold-rgb))]" : "bg-ink/30"
                }`}
              />
              {a.label}
              {a.holder && <span className="text-xs text-ink/50">— {a.holder.userName}</span>}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">{selected.label}</p>
              <p className="text-sm text-ink/60">
                {statusLabel(selected.status)}
                {selected.holder ? ` — held by ${selected.holder.userName}${isHolder ? " (you)" : ""}` : " — available to claim"}
              </p>
            </div>
            <div className="flex gap-2">
              {!selected.holder && (
                <Button onClick={() => runAction(selected.id, api.claimLinkedinOutreachSession)} loading={busy}>
                  Claim
                </Button>
              )}
              {selected.holder && isHolder && (
                <Button variant="secondary" onClick={() => runAction(selected.id, api.releaseLinkedinOutreachSession)} loading={busy}>
                  Release
                </Button>
              )}
              {selected.holder && !isHolder && (
                <Button
                  variant="secondary"
                  loading={busy}
                  onClick={() => {
                    if (window.confirm(`${selected.holder!.userName} currently holds "${selected.label}" — take over now?`)) {
                      runAction(selected.id, api.takeoverLinkedinOutreachSession);
                    }
                  }}
                >
                  Take over
                </Button>
              )}
              {isPrimaryAdmin && (
                <Button
                  variant="danger"
                  loading={busy}
                  onClick={() => {
                    if (window.confirm(`This logs "${selected.label}" out completely and wipes it — the next claim will need a fresh login. Continue?`)) {
                      runAction(selected.id, api.logoutLinkedinOutreachSession);
                    }
                  }}
                >
                  Reset / Log out
                </Button>
              )}
              {isPrimaryAdmin && (
                <Button variant="danger" loading={busy} onClick={() => handleRemoveAccount(selected)}>
                  Remove
                </Button>
              )}
            </div>
          </div>

          <div className="overflow-auto rounded-lg border border-[var(--line)] bg-black/90 p-2">
            <canvas
              ref={canvasRef}
              tabIndex={isHolder ? 0 : -1}
              onMouseMove={handleMouseMove}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              onContextMenu={(e) => e.preventDefault()}
              className={`max-w-full ${isHolder ? "cursor-default" : "cursor-not-allowed opacity-80"}`}
              style={{ outline: "none" }}
            />
            {!selected.holder && <p className="mt-2 text-center text-xs text-ink/50">Claim the session to see and drive the live browser.</p>}
            {selected.holder && !isHolder && <p className="mt-2 text-center text-xs text-ink/50">Watching read-only — {selected.holder.userName} is driving.</p>}
            {isHolder && selected.status === "AWAITING_LOGIN" && (
              <p className="mt-2 text-center text-xs text-ink/50">LinkedIn needs a login/verification — click into the view above and sign in as usual.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
