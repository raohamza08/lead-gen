"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasSession } from "../lib/api-client";

/**
 * Client-side route guard for the dashboard.
 *
 * It has to run on the client, not in Next.js middleware: the session lives in
 * localStorage, which middleware (running on the server, before hydration)
 * cannot read. Moving tokens to cookies would allow a middleware guard and is
 * the better long-term shape, but it changes the auth model.
 *
 * Children are not rendered until a session is confirmed. That ordering is the
 * point — every dashboard page fetches on mount, so rendering first and
 * redirecting after would fire a burst of unauthenticated requests and paint a
 * screen of raw 401 errors before the redirect landed.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "authed">("checking");

  useEffect(() => {
    if (hasSession()) {
      setState("authed");
    } else {
      router.replace("/login");
    }
  }, [router]);

  if (state === "checking") {
    return <p className="p-6 text-sm text-ink/60">Loading…</p>;
  }

  return <>{children}</>;
}
