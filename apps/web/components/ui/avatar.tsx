/** Shared circular avatar — real image when one exists, a stable colored
 *  initial/initials fallback otherwise (Part: Social Inbox removal /
 *  per-module messaging, 2026-10-21). Consolidates two independent
 *  implementations that grew up separately: accounts/[id]/page.tsx's
 *  AccountAvatar (image-or-single-initial) and the color-hashing idea
 *  Email Hub's message-detail-panel.tsx also has (left untouched there —
 *  it works, nobody asked to change it, and this component is scoped to
 *  Social Media's new conversation list/detail/feed UI only).
 *
 *  Palette switched to the shared pastel-bg/near-black-text pairs (Part:
 *  full UI redesign per UI.md, 2026-10-23, Section 4) instead of its own
 *  independent vivid-bg/white-text one — same identity-color system as
 *  components/avatar.tsx's Avatar/InitialsAvatar, just re-exported here
 *  rather than duplicated a third time, since this component's `imageUrl`+
 *  `size`-number API is already load-bearing across Social Media. */
import { avatarColors, initialsFrom } from "../avatar";

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
  const colors = avatarColors(name || "?");
  return (
    <div
      style={{ height: size, width: size, backgroundColor: colors.bg, color: colors.text, fontSize: Math.max(10, size * 0.4) }}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
    >
      {initialsFrom(name || "?")}
    </div>
  );
}
