"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../lib/api-client";
import { Avatar } from "./avatar";
import { Dropdown, DropdownTrigger, DropdownContent, DropdownItem, DropdownSeparator } from "./ui/dropdown";

interface Me {
  name: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/** Header identity + actions (Part: UI/UX Redesign, 2026-09-01) — folds in
 *  what used to be a separate SignOutButton, and is now the only place
 *  Profile is reachable from (previously duplicated as a flat sidebar link
 *  too, see sidebar-nav.tsx). Same avatar/initials shown everywhere else the
 *  user's identity appears (Part: User Profile, 2026-08-31). */
export function HeaderUserMenu() {
  const [me, setMe] = useState<Me | null>(null);
  const router = useRouter();

  useEffect(() => {
    api
      .getMe()
      .then((res) => setMe(res as Me))
      .catch(() => undefined);
  }, []);

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
        <DropdownSeparator />
        <DropdownItem destructive onSelect={handleSignOut}>
          Sign out
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}
