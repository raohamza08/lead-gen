"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "../../../../components/ui/tabs";
import { PlatformInbox } from "../../../../components/social-media/platform-inbox";
import { WhatsAppQrNumbersList } from "../../../../components/social-media/whatsapp-qr-numbers-list";

const PLATFORM = "WHATSAPP_QR";
const LABEL = "WhatsApp (Team)";
const ROUTE = "/social-media/whatsapp-qr";
const TAB_DEFS = [
  { value: "inbox", label: "Inbox" },
  { value: "numbers", label: "Numbers" },
];

/**
 * WhatsApp Team Inbox (Part: WhatsApp Team Inbox, 2026-10-26) -- a QR-scan-
 * once, Baileys-backed shared number, distinct from the Cloud API WhatsApp
 * page right above it in the nav. Always has an Inbox tab (no capabilities
 * lookup needed the way the Cloud API page does -- this platform's
 * capabilities.dms is always true) and a Numbers tab instead of
 * Accounts/Feed: there's no OAuth connect flow or publish/feed concept
 * here at all, just QR connect/reconnect/disconnect.
 */
function WhatsAppQrPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const requestedTab = searchParams?.get("tab") ?? TAB_DEFS[0].value;
  const tab = TAB_DEFS.some((t) => t.value === requestedTab) ? requestedTab : TAB_DEFS[0].value;
  const accountId = searchParams?.get("accountId") ?? undefined;
  const conversationId = searchParams?.get("conversationId") ?? undefined;

  function selectTab(value: string) {
    router.push(`${ROUTE}?tab=${value}`);
  }

  return (
    <div className="whatsapp-scope flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <WhatsAppBadge />
        <h1 className="text-lg font-semibold tracking-tight">{LABEL}</h1>
      </div>
      <Tabs value={tab} onValueChange={selectTab} tabs={TAB_DEFS} />
      {tab === "inbox" && <PlatformInbox platform={PLATFORM} initialAccountId={accountId} initialConversationId={conversationId} />}
      {tab === "numbers" && <WhatsAppQrNumbersList />}
    </div>
  );
}

/** Brand badge next to the module title (Part: WhatsApp module green reskin,
 *  2026-10-27) — a small circular WhatsApp glyph, same accent token every
 *  other green element on this page now reads from. */
function WhatsAppBadge() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-white">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.4A10 10 0 1 0 12 2Zm0 1.8A8.2 8.2 0 1 1 6.8 17l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8Zm-3.4 4a.9.9 0 0 0-.6.3c-.2.2-.8.8-.8 1.9s.8 2.2.9 2.4c.1.1 1.6 2.5 3.9 3.5 1.9.8 2.3.7 2.7.6.6-.1 1.3-.5 1.5-1 .2-.5.2-1 .1-1.1-.1-.1-.2-.2-.5-.3l-1.5-.7c-.2-.1-.4-.1-.5.1l-.6.8c-.1.1-.2.2-.4.1-.2-.1-.9-.3-1.7-1-.6-.6-1-1.3-1.2-1.5-.1-.2 0-.3.1-.4l.4-.5c.1-.1.1-.3.1-.4 0-.1-.5-1.3-.7-1.8-.2-.4-.4-.4-.5-.4h-.5Z" />
      </svg>
    </span>
  );
}

export default function WhatsAppQrPage() {
  return (
    <Suspense fallback={null}>
      <WhatsAppQrPageContent />
    </Suspense>
  );
}
