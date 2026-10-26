"use client";

import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { getAccessToken, refreshAccessToken } from "./api-client";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

let socket: Socket | null = null;

/**
 * One socket per browser tab, lazily created and reused across every page —
 * every dashboard screen that wants live updates calls this instead of each
 * opening its own connection.
 *
 * Re-authenticates with a guaranteed-fresh token whenever a (re)connect
 * attempt fails (Part: realtime reconnect token staleness, 2026-10-26, bug
 * fix -- confirmed in production, repeated "jwt expired" rejections after
 * every API restart). The access token lives 15 minutes; a tab can easily
 * sit open longer than that with no HTTP call happening to trigger the
 * normal 401-driven refresh in api-client.ts's `request()`. Every API
 * restart (every deploy disconnects every open socket) then has socket.io's
 * built-in auto-reconnect retry using whatever token was last set on
 * `socket.auth` -- if that's the same expired one, every single attempt
 * fails and nothing else ever updates it, so the only fix was a full page
 * reload. `connect_error` fires on both the first failed connection and
 * every failed reconnection attempt, with socket.io's own backoff delay
 * before the next one -- plenty of time for the async refresh below to
 * land before it's needed.
 */
function getSocket(): Socket | null {
  const token = getAccessToken();
  if (!token) return null;

  if (!socket) {
    // The gateway lives on the bare API origin, not under /api/v1 — strip the
    // REST prefix the same way a raw WebSocket URL would need to.
    const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, "");
    socket = io(origin, { auth: { token }, transports: ["websocket", "polling"] });
    socket.on("connect_error", async () => {
      const fresh = await refreshAccessToken();
      if (socket && fresh) socket.auth = { token: fresh };
    });
    // Browsers can throttle/pause a backgrounded tab's reconnect backoff
    // timers (Part: realtime reconnect token staleness, 2026-10-26) --
    // forcing a reconnect check on refocus means coming back to an old tab
    // doesn't depend on that backoff having happened to land while hidden.
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", async () => {
        if (document.visibilityState === "visible" && socket && !socket.connected) {
          const fresh = await refreshAccessToken();
          socket.auth = { token: fresh ?? getAccessToken() };
          socket.connect();
        }
      });
    }
  } else {
    socket.auth = { token };
  }
  return socket;
}

/**
 * Subscribes to one realtime event for the lifetime of the calling
 * component. This is the ONLY way dashboard screens should learn that
 * something changed server-side — no page in this app should ever need a
 * manual refresh or a polling interval to see current state.
 */
export function useRealtimeEvent<T = unknown>(event: string, handler: (payload: T) => void): void {
  // The socket subscription itself only (re)runs when `event` changes, but
  // `handler` closures over whatever state/props were current on whichever
  // render last ran this hook — without this ref, a handler that reads
  // state (e.g. a notification preference loaded after mount) would stay
  // forever stuck reading its value from the FIRST render, since the
  // effect below never re-subscribes to pick up a newer closure. Confirmed
  // real bug (Part: desktop notifications, 2026-10-23): preferences loaded
  // async after mount, so every handler relying on them silently saw `null`
  // forever even once the real preference arrived.
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const wrapped = (payload: T) => handlerRef.current(payload);
    s.on(event, wrapped);
    return () => {
      s.off(event, wrapped);
    };
  }, [event]);
}

/**
 * Refetches on any of the given events, debounced — several agent-run events
 * can land within milliseconds of each other (a pipeline finishing five
 * steps back to back), and a full-list refetch per event would stampede the
 * API for no benefit over one refetch a moment later. Board/list screens
 * that don't track per-card state precisely enough to patch it in place use
 * this instead of hand-merging every possible field.
 */
export function useRealtimeRefetch(events: string[], refetch: () => void, debounceMs = 400): void {
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refetch, debounceMs);
    };
    events.forEach((event) => s.on(event, trigger));
    return () => {
      events.forEach((event) => s.off(event, trigger));
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.join(","), debounceMs]);
}
