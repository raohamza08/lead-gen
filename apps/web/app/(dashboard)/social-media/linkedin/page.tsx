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

const PLATFORM = "LINKEDIN";
const LABEL = "LinkedIn";
const ROUTE = "/social-media/linkedin";

/**
 * LinkedIn's own workspace (Part: Social Inbox removal / per-module
 * messaging, 2026-10-21) — LinkedIn's own API has no DM support at all
 * (dms capability is hardcoded false in linkedin.provider.ts), so this page
 * never shows an Inbox tab; Feed renders the existing honest
 * UnavailableFallback card (LinkedIn's listFeed() always throws today —
 * see account-feed.tsx's own docblock) rather than being hidden, matching
 * this codebase's "never branch per platform in the UI" convention.
 */
function LinkedInPageContent() {
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

export default function LinkedInPage() {
  return (
    <Suspense fallback={null}>
      <LinkedInPageContent />
    </Suspense>
  );
}
