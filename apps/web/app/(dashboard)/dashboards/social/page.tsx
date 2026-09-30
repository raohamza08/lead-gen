import { redirect } from "next/navigation";

/** Consolidated into the unified /dashboards tab view (Part: Dashboard
 *  Center tab consolidation, 2026-09-30) — this route stays only so an old
 *  bookmark/link lands somewhere real instead of a 404. */
export default function SocialDashboardRedirect() {
  redirect("/dashboards?tab=social");
}
