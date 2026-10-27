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
    <div className="whatsapp-scope flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <WhatsAppBadge />
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

/** Brand badge next to the module title (Part: WhatsApp module green reskin,
 *  2026-10-27) — a small circular WhatsApp glyph, same accent token every
 *  other green element on this page now reads from. Duplicated from the
 *  WhatsApp (Team)/whatsapp-qr page rather than shared, matching how these
 *  two WhatsApp pages already each keep their own small page-shell bits. */
function WhatsAppBadge() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-white">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
        <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.4A10 10 0 1 0 12 2Zm0 1.8A8.2 8.2 0 1 1 6.8 17l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8Zm-3.4 4a.9.9 0 0 0-.6.3c-.2.2-.8.8-.8 1.9s.8 2.2.9 2.4c.1.1 1.6 2.5 3.9 3.5 1.9.8 2.3.7 2.7.6.6-.1 1.3-.5 1.5-1 .2-.5.2-1 .1-1.1-.1-.1-.2-.2-.5-.3l-1.5-.7c-.2-.1-.4-.1-.5.1l-.6.8c-.1.1-.2.2-.4.1-.2-.1-.9-.3-1.7-1-.6-.6-1-1.3-1.2-1.5-.1-.2 0-.3.1-.4l.4-.5c.1-.1.1-.3.1-.4 0-.1-.5-1.3-.7-1.8-.2-.4-.4-.4-.5-.4h-.5Z" />
      </svg>
    </span>
  );
}

export default function WhatsAppPage() {
  return (
    <Suspense fallback={null}>
      <WhatsAppPageContent />
    </Suspense>
  );
}
