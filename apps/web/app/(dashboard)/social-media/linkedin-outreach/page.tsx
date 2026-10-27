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

/**
 * Remote-controls the one persistent, shared company LinkedIn browser
 * session (Part: LinkedIn Outreach, shared-session shift handoff — explicit
 * user request: three office shifts, one person on duty at a time, log in
 * once instead of every shift re-authenticating). The canvas below is a
 * live view of a real server-side Chromium tab (JPEG frames pushed over
 * the socket) — mouse/keyboard captured here are forwarded the same way,
 * so whoever holds the claim is genuinely driving that one browser, not a
 * copy of it. No LinkedIn credentials ever pass through this app's own
 * code: the first login (and any 2FA) is typed by a real person straight
 * into the live view, same as sitting at a remote desktop.
 */
export default function LinkedinOutreachPage() {
  const myUserId = getCurrentUser()?.sub;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [holder, setHolder] = useState<Holder | null>(null);
  const [isPrimaryAdmin, setIsPrimaryAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isHolder = Boolean(holder && myUserId && holder.userId === myUserId);

  useEffect(() => {
    imageRef.current = new window.Image();
  }, []);

  useEffect(() => {
    api
      .getLinkedinOutreachStatus()
      .then((res) => {
        const r = res as { status: SessionStatus; holder: Holder | null };
        setStatus(r.status);
        setHolder(r.holder);
      })
      .catch((err) => setError((err as Error).message));
    api
      .getMe()
      .then((me) => setIsPrimaryAdmin(Boolean((me as { isPrimaryAdmin?: boolean }).isPrimaryAdmin)))
      .catch(() => undefined);
  }, []);

  useRealtimeEvent<{ status: SessionStatus }>("linkedinSession.status", ({ status }) => setStatus(status));
  useRealtimeEvent<{ holder: Holder | null }>("linkedinSession.lock", ({ holder }) => setHolder(holder));
  useRealtimeEvent<{ by: string }>("linkedinSession.kicked", ({ by }) => setNotice(`${by} took over the session.`));
  useRealtimeEvent<{ data: string }>("linkedinSession.frame", ({ data }) => {
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

  async function runAction(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      const r = res as { status?: SessionStatus; holder?: Holder | null };
      if (r.status) setStatus(r.status);
      if (r.holder !== undefined) setHolder(r.holder);
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

  const sendInput = useCallback((payload: unknown) => emitRealtimeEvent("linkedinSession.input", payload), []);

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
  function handleKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!isHolder) return;
    e.preventDefault();
    sendInput({ type: "keyDown", key: e.key, code: e.code });
  }
  function handleKeyUp(e: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!isHolder) return;
    e.preventDefault();
    sendInput({ type: "keyUp", key: e.key, code: e.code });
  }

  const statusLabel =
    status === "ACTIVE" ? "Logged in" : status === "AWAITING_LOGIN" ? "Needs login" : status === "LOGGED_OUT" ? "Logged out" : "Checking…";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">LinkedIn Outreach</h1>
          <p className="text-sm text-ink/60">
            {statusLabel}
            {holder ? ` — held by ${holder.userName}${isHolder ? " (you)" : ""}` : " — available to claim"}
          </p>
        </div>
        <div className="flex gap-2">
          {!holder && (
            <Button onClick={() => runAction(api.claimLinkedinOutreachSession)} loading={busy}>
              Claim
            </Button>
          )}
          {holder && isHolder && (
            <Button variant="secondary" onClick={() => runAction(api.releaseLinkedinOutreachSession)} loading={busy}>
              Release
            </Button>
          )}
          {holder && !isHolder && (
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => {
                if (window.confirm(`${holder.userName} currently holds this session — take over now?`)) {
                  runAction(api.takeoverLinkedinOutreachSession);
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
                if (window.confirm("This logs the shared LinkedIn session out completely and wipes it — the next claim will need a fresh login. Continue?")) {
                  runAction(api.logoutLinkedinOutreachSession);
                }
              }}
            >
              Reset / Log out
            </Button>
          )}
        </div>
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
        {!holder && <p className="mt-2 text-center text-xs text-ink/50">Claim the session to see and drive the live browser.</p>}
        {holder && !isHolder && <p className="mt-2 text-center text-xs text-ink/50">Watching read-only — {holder.userName} is driving.</p>}
        {isHolder && status === "AWAITING_LOGIN" && (
          <p className="mt-2 text-center text-xs text-ink/50">LinkedIn needs a login/verification — click into the view above and sign in as usual.</p>
        )}
      </div>
    </div>
  );
}
