/** Shared circular avatar — real image when one exists, a stable colored
 *  initial/initials fallback otherwise (Part: Social Inbox removal /
 *  per-module messaging, 2026-10-21). Consolidates two independent
 *  implementations that grew up separately: accounts/[id]/page.tsx's
 *  AccountAvatar (image-or-single-initial) and the color-hashing idea
 *  Email Hub's message-detail-panel.tsx also has (left untouched there —
 *  it works, nobody asked to change it, and this component is scoped to
 *  Social Media's new conversation list/detail/feed UI only). */

const PALETTE = ["#6366f1", "#0891b2", "#c026d3", "#d97706", "#059669", "#dc2626", "#4f46e5", "#0d9488"];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase() || "?";
}

export function Avatar({ name, imageUrl, size = 36 }: { name: string; imageUrl?: string | null; size?: number }) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        style={{ height: size, width: size }}
        className="shrink-0 rounded-full object-cover ring-1 ring-[var(--line)]"
      />
    );
  }
  return (
    <div
      style={{ height: size, width: size, backgroundColor: colorFor(name || "?"), fontSize: Math.max(10, size * 0.4) }}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
    >
      {initialsFor(name || "?")}
    </div>
  );
}
