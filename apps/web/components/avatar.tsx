"use client";

const AVATAR_PALETTE = ["#6366f1", "#0891b2", "#c026d3", "#d97706", "#059669", "#dc2626", "#4f46e5", "#0d9488"];

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function initials(name: string | null | undefined, email: string): string {
  const source = (name || email).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/**
 * A user's identity, shown consistently everywhere it appears — header,
 * team list, My Profile (Part: User Profile, 2026-08-31). Extracted from
 * the color-hash + initials pattern message-detail-panel.tsx already used
 * for email senders, so the visual language matches instead of introducing
 * a second avatar style for the logged-in user specifically.
 */
export function Avatar({
  name,
  email,
  avatarUrl,
  sizeClass = "h-8 w-8 text-xs",
}: {
  name?: string | null;
  email: string;
  avatarUrl?: string | null;
  sizeClass?: string;
}) {
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- avatars are user-uploaded, arbitrary dimensions unknown ahead of time
    return <img src={avatarUrl} alt="" className={`shrink-0 rounded-full object-cover ${sizeClass}`} />;
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${sizeClass}`}
      style={{ backgroundColor: avatarColor(email) }}
    >
      {initials(name, email)}
    </div>
  );
}
