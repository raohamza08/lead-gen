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
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{LABEL}</h1>
      </div>
      <Tabs value={tab} onValueChange={selectTab} tabs={TAB_DEFS} />
      {tab === "inbox" && <PlatformInbox platform={PLATFORM} initialAccountId={accountId} initialConversationId={conversationId} />}
      {tab === "numbers" && <WhatsAppQrNumbersList />}
    </div>
  );
}

export default function WhatsAppQrPage() {
  return (
    <Suspense fallback={null}>
      <WhatsAppQrPageContent />
    </Suspense>
  );
}
