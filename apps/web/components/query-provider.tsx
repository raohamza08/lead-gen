"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * App-wide data cache (Part: system-wide caching). One QueryClient per
 * browser session, held in state so it survives re-renders but not a full
 * page reload — a cached page shows instantly on revisit within the same
 * session, then quietly refetches in the background rather than blocking
 * on a spinner every time.
 *
 * `staleTime` is deliberately non-zero: without it, React Query treats
 * every cached value as stale the instant it lands and refetches on every
 * remount anyway, which defeats the entire point of caching. 60s is long
 * enough that switching tabs and back feels instant, short enough that a
 * genuinely new lead/email still shows up within a minute without a manual
 * refresh — pages that need to feel "live" (e.g. via WebSocket events)
 * already have their own realtime refetch trigger and can override this
 * per-query.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
