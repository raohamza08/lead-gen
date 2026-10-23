"use client";

/** Pastel-background / near-black-text pairs (Part: full UI redesign per
 *  UI.md, 2026-10-23, Section 4) — replaces the old vivid-bg/white-text
 *  palette. Spec: "Outlook derives a consistent background/text color
 *  pair per sender from a hash of their name/email, picked from a small
 *  curated palette (soft teal, tan, lavender, sage, dusty rose, etc. —
 *  all muted/pastel, paired with a near-black version of the same hue...)
 *  hash the contact/company id -> pick from ~8-10 pastel/dark-text
 *  pairs." Teal and tan/gold are the spec's own two measured examples;
 *  the rest extend the same muted-pastel-plus-matching-dark-hue formula
 *  to the same count. */
const AVATAR_PALETTE: { bg: string; text: string }[] = [
  { bg: "#94C8D4", text: "#00333F" }, // teal
  { bg: "#E0CEA2", text: "#553E06" }, // tan/gold
  { bg: "#D4C5E8", text: "#3D2A52" }, // lavender
  { bg: "#C3D9B5", text: "#2B3D1F" }, // sage
  { bg: "#E8C5CE", text: "#52222E" }, // dusty rose
  { bg: "#BFD9E8", text: "#1C3A52" }, // sky
  { bg: "#F0D0B8", text: "#5C3A1A" }, // peach
  { bg: "#D9C2D4", text: "#452E42" }, // mauve
];

export function avatarColors(seed: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function initialsFrom(text: string | null | undefined): string {
  const source = (text || "").trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function initials(name: string | null | undefined, email: string): string {
  return initialsFrom(name || email);
}

/** Same pastel-pair identity system as {@link Avatar}, for records that
 *  aren't literally a user with an email (Part: full UI redesign per
 *  UI.md, 2026-10-23) — a job's client/company, a chat room, a deal. Color
 *  and initials are both derived from `seed` (pass whatever uniquely
 *  identifies the record — a room name, a company name, a record id). */
export function InitialsAvatar({ seed, label, sizeClass = "h-8 w-8 text-xs" }: { seed: string; label?: string; sizeClass?: string }) {
  const colors = avatarColors(seed);
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${sizeClass}`}
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {initialsFrom(label ?? seed)}
    </div>
  );
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
  const colors = avatarColors(email);
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${sizeClass}`}
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {initials(name, email)}
    </div>
  );
}
