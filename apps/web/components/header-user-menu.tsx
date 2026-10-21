"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "../lib/api-client";
import { Avatar } from "./avatar";
import { Dropdown, DropdownTrigger, DropdownContent, DropdownItem, DropdownSeparator } from "./ui/dropdown";

interface Me {
  name: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  isPrimaryAdmin: boolean;
}

/** Header identity + actions (Part: UI/UX Redesign, 2026-09-01) — folds in
 *  what used to be a separate SignOutButton, and is now the only place
 *  Profile is reachable from (previously duplicated as a flat sidebar link
 *  too, see sidebar-nav.tsx). Same avatar/initials shown everywhere else the
 *  user's identity appears (Part: User Profile, 2026-08-31). */
export function HeaderUserMenu() {
  // Shared ["me"] query key with the Profile page (Part: real-world bug —
  // this used to be its own one-shot fetch-on-mount, so uploading a new
  // avatar on /profile updated that page but left this header icon
  // showing the stale picture until a full reload). The Profile page
  // invalidates this same key after any avatar/profile change, which
  // refetches here too without needing a reload.
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: () => api.getMe() as Promise<Me> });
  const router = useRouter();

  async function handleSignOut() {
    // api.logout revokes the refresh token server-side and clears local
    // storage; it swallows a failed revoke so a network error can't leave the
    // user stuck signed in on this device.
    await api.logout();
    router.replace("/login");
  }

  if (!me) return null;

  return (
    <Dropdown>
      <DropdownTrigger className="rounded-full transition-opacity duration-fast hover:opacity-80" aria-label="Account menu">
        <Avatar name={me.displayName || me.name} email={me.email} avatarUrl={me.avatarUrl} sizeClass="h-8 w-8 text-xs" />
      </DropdownTrigger>
      <DropdownContent>
        <div className="px-2.5 py-1.5">
          <div className="truncate text-sm font-medium text-ink">{me.displayName || me.name}</div>
          <div className="truncate text-xs text-ink/50">{me.email}</div>
        </div>
        <DropdownSeparator />
        <DropdownItem onSelect={() => router.push("/profile")}>My Profile</DropdownItem>
        {/* Settings and System Logs moved here (Part: EBOS-inspired shell
            redesign, 2026-10-21) -- both used to be standalone top-level
            sidebar links; neither belongs to any one icon-rail workspace,
            same as EBOS keeps account/admin-level things out of its own
            workspace rail. System Logs keeps its exact same primary-admin-
            only gating (UX-only -- PrimaryAdminGuard on the backend route
            is the real enforcement, same as before). */}
        <DropdownItem onSelect={() => router.push("/settings")}>Settings</DropdownItem>
        {me.isPrimaryAdmin && <DropdownItem onSelect={() => router.push("/admin/system-logs")}>System Logs</DropdownItem>}
        <DropdownSeparator />
        <DropdownItem destructive onSelect={handleSignOut}>
          Sign out
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
