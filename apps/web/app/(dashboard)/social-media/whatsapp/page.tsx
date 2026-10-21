"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../../lib/api-client";
import { Tabs } from "../../../../components/ui/tabs";
import { PlatformAccountsList } from "../../../../components/social-media/platform-accounts-list";
import { PlatformInbox } from "../../../../components/social-media/platform-inbox";
import { PlatformFeed } from "../../../../components/social-media/platform-feed";

interface Capabilities {
  dms: boolean;
  publish: boolean;
}

const PLATFORM = "WHATSAPP";
const LABEL = "WhatsApp";
const ROUTE = "/social-media/whatsapp";

/**
 * WhatsApp's own workspace (Part: Social Inbox removal / per-module
 * messaging, 2026-10-21) — WhatsApp is messaging-only (publish/analytics/
 * comments are all false in whatsapp.provider.ts — "no public feed or
 * posting concept"), so this page never shows a Feed tab; Inbox is its
 * primary surface.
 */
function WhatsAppPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const capabilitiesQuery = useQuery({
    queryKey: ["social-media-capabilities"],
    queryFn: () => api.getSocialCapabilities() as Promise<Record<string, Capabilities>>,
  });
  const caps = capabilitiesQuery.data?.[PLATFORM];
  const hasInbox = caps?.dms ?? false;
  const hasFeed = caps?.publish ?? false;

  if (capabilitiesQuery.isLoading) return <p className="text-sm text-ink/50">Loading…</p>;

  const tabDefs = [
    ...(hasInbox ? [{ value: "inbox", label: "Inbox" }] : []),
    ...(hasFeed ? [{ value: "feed", label: "Feed" }] : []),
    { value: "accounts", label: "Accounts" },
  ];
  const requestedTab = searchParams?.get("tab") ?? tabDefs[0].value;
  const tab = tabDefs.some((t) => t.value === requestedTab) ? requestedTab : tabDefs[0].value;
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
      <Tabs value={tab} onValueChange={selectTab} tabs={tabDefs} />
      {tab === "inbox" && hasInbox && (
        <PlatformInbox platform={PLATFORM} initialAccountId={accountId} initialConversationId={conversationId} />
      )}
      {tab === "feed" && hasFeed && <PlatformFeed platform={PLATFORM} />}
      {tab === "accounts" && <PlatformAccountsList platform={PLATFORM} label={LABEL} />}
    </div>
  );
}

export default function WhatsAppPage() {
  return (
    <Suspense fallback={null}>
      <WhatsAppPageContent />
    </Suspense>
  );
}
