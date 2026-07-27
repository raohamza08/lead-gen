import { Lead } from "@leadgen/types";

/**
 * Email #1/#2 are deliberately low-personalization templates (Part D1) — they
 * only need company name + industry + one verified fact, unlike Email #3 which
 * requires the full Gemini context-assembly pipeline (Part D2).
 */
export function buildEmail1(lead: Pick<Lead, "companyName" | "industry" | "contactName">) {
  const greeting = lead.contactName ? `Hi ${firstName(lead.contactName)},` : "Hi there,";
  return {
    subject: `Quick thought for ${lead.companyName}`,
    bodyHtml: `
      <p>${greeting}</p>
      <p>I've been looking at how ${lead.industry ?? "companies like yours"} are adopting AI for the
      day-to-day work that used to eat up a team's time — lead follow-up, reporting, scheduling, that kind of thing.</p>
      <p>Wanted to introduce ${"{{org.name}}"} — we help businesses put that kind of automation in place without
      a big platform migration. No pitch here, just flagging it in case it's useful context as you're
      thinking about where AI fits for ${lead.companyName}.</p>
      <p>Happy to share what we're seeing work well in ${lead.industry ?? "your space"} if that'd be useful.</p>
      <p>{{sender.name}}</p>
      <p style="font-size:12px;color:#888">{{org.postal_address}} · <a href="{{unsubscribe_link}}">Unsubscribe</a></p>
    `.trim(),
  };
}

export function buildEmail2(lead: Pick<Lead, "companyName" | "industry">, caseStudySummary?: string) {
  return {
    subject: `How a ${lead.industry ?? "similar"} team cut manual work with AI`,
    bodyHtml: `
      <p>Following up briefly —</p>
      <p>${caseStudySummary ?? `We recently helped a ${lead.industry ?? "similar"} business automate a chunk of their manual workflow, cutting turnaround time significantly without adding headcount.`}</p>
      <p>No ask here either — just thought the specifics might be relevant to ${lead.companyName}.</p>
      <p>{{sender.name}}</p>
      <p style="font-size:12px;color:#888">{{org.postal_address}} · <a href="{{unsubscribe_link}}">Unsubscribe</a></p>
    `.trim(),
  };
}

function firstName(fullName: string): string {
  return fullName.split(" ")[0];
}
