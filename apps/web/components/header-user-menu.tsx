"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../lib/api-client";
import { Avatar } from "./avatar";

interface Me {
  name: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/** Links to My Profile, showing the same avatar/initials used everywhere
 *  else the user's identity appears (Part: User Profile, 2026-08-31). */
export function HeaderUserMenu() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api
      .getMe()
      .then((res) => setMe(res as Me))
      .catch(() => undefined);
  }, []);

  if (!me) return null;

  return (
    <Link href="/profile" title="My Profile" className="rounded-full transition-opacity hover:opacity-80">
      <Avatar name={me.displayName || me.name} email={me.email} avatarUrl={me.avatarUrl} sizeClass="h-8 w-8 text-xs" />
    </Link>
  );
}
