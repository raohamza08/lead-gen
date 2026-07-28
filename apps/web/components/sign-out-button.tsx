"use client";

import { useRouter } from "next/navigation";
import { api } from "../lib/api-client";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    // api.logout revokes the refresh token server-side and clears local
    // storage; it swallows a failed revoke so a network error can't leave the
    // user stuck signed in on this device.
    await api.logout();
    router.replace("/login");
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="rounded-md border border-[var(--line)] px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-ink/5"
    >
      Sign out
    </button>
  );
}
