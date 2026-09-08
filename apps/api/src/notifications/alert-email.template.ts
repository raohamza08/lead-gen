/**
 * Shared visual identity for every automated alert email this app sends
 * (Part: alert email branding, 2026-09-08) — deliberately distinct from
 * the outreach/business emails a lead or a customer ever sees: dark,
 * monospace, security-ops styled, so a glance at the inbox tells the admin
 * "this is the system talking to me," not "this is a client email."
 * Inline styles only, no <style> block or external assets — most email
 * clients (Outlook in particular) strip or ignore anything else.
 */

/** The "from" display name for every alert email — never the org's normal
 *  branding name (EmailOrgName), which is what outreach/welcome emails use.
 *  Kept as one exported constant so every call site names the same sender. */
export const ALERT_EMAIL_FROM_NAME = "Outly Sentinel";

const PALETTE = {
  alert: { accent: "#ff3b3b", accentBg: "#2a0f0f", label: "SECURITY ALERT" },
  resolved: { accent: "#2ea043", accentBg: "#0f2a16", label: "STATUS: RESOLVED" },
} as const;

/** Renders one alert email's full HTML body. `tone` picks the accent color
 *  and banner label — "alert" (red) for anything wrong, "resolved" (green)
 *  for a "back to normal" follow-up (e.g. an account auto-resumed, ai-workers
 *  back online) so the two read as visually distinct at a glance without
 *  needing to read the copy. */
export function renderAlertEmail(params: {
  title: string;
  message: string;
  actionUrl?: string;
  tone?: "alert" | "resolved";
}): string {
  const { title, message, actionUrl } = params;
  const p = PALETTE[params.tone ?? "alert"];
  return `
<div style="background:#0a0e14;padding:32px 16px;">
  <div style="max-width:520px;margin:0 auto;background:#0d1117;border:1px solid #21262d;border-radius:6px;overflow:hidden;font-family:'Courier New',Consolas,Menlo,monospace;">
    <div style="background:${p.accentBg};border-bottom:1px solid ${p.accent};padding:14px 20px;">
      <div style="color:${p.accent};font-size:11px;letter-spacing:2px;font-weight:bold;">&#9888; OUTLY SENTINEL &mdash; ${p.label}</div>
      <div style="color:#8b949e;font-size:10px;letter-spacing:1.5px;margin-top:3px;">CONFIDENTIAL &middot; AUTOMATED SYSTEM NOTICE &middot; INTERNAL USE ONLY</div>
    </div>
    <div style="padding:24px 20px;">
      <h2 style="color:#f0f6fc;font-size:17px;margin:0 0 14px;font-weight:600;">${title}</h2>
      <p style="color:#c9d1d9;font-size:13.5px;line-height:1.7;margin:0 0 22px;white-space:pre-wrap;">${message}</p>
      ${
        actionUrl
          ? `<a href="${actionUrl}" style="display:inline-block;background:${p.accent};color:#0a0e14;text-decoration:none;padding:10px 22px;border-radius:4px;font-size:12px;font-weight:bold;letter-spacing:0.5px;">INVESTIGATE &rarr;</a>`
          : ""
      }
    </div>
    <div style="border-top:1px solid #21262d;padding:14px 20px;color:#484f58;font-size:10.5px;letter-spacing:0.5px;">
      Automated dispatch &middot; ${new Date().toISOString()} &middot; do not reply to this address
    </div>
  </div>
</div>`;
}
