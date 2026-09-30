import { redirect } from "next/navigation";

/** Consolidated into the Dashboard Center's Meta Ads tab (Part: Dashboard
 *  Center tab consolidation, 2026-09-30 — "remove the meta ads overview and
 *  just keep its dashboard in the dashboard center"). This route stays only
 *  so an old bookmark/link lands somewhere real instead of a 404. Campaigns/
 *  Ad Sets/Ads and Settings are unaffected, still their own real pages. */
export default function MetaAdsOverviewRedirect() {
  redirect("/dashboards?tab=meta-ads");
}
