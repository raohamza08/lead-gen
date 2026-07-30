"use client";

import { useEffect } from "react";
import { io, Socket } from "socket.io-client";
import { getAccessToken } from "./api-client";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

let socket: Socket | null = null;

/**
 * One socket per browser tab, lazily created and reused across every page —
 * every dashboard screen that wants live updates calls this instead of each
 * opening its own connection. Re-authenticates on every (re)connect with
 * whatever access token is current, so a token refresh mid-session doesn't
 * leave the socket stuck on a stale one.
 */
function getSocket(): Socket | null {
  const token = getAccessToken();
  if (!token) return null;

  if (!socket) {
    // The gateway lives on the bare API origin, not under /api/v1 — strip the
    // REST prefix the same way a raw WebSocket URL would need to.
    const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, "");
    socket = io(origin, { auth: { token }, transports: ["websocket", "polling"] });
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
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    s.on(event, handler);
    return () => {
      s.off(event, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
