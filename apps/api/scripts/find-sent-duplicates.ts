/**
 * Read-only diagnostic (Part: Email Hub Sent-view duplicate fix, 2026-09-02)
 * — companion to dedupe-sent-messages.ts. That script only matches
 * duplicates sharing an identical (accountId, messageIdHeader), which is
 * the exact pairing the ensureMessageId bug produced. This casts a wider
 * net (same account + subject + recipients) in case some duplicates have a
 * null or otherwise-mismatched messageIdHeader on one side and wouldn't
 * show up in the narrower query — read-only, writes nothing.
 *
 *   npx ts-node --transpile-only apps/api/scripts/find-sent-duplicates.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw<
    { account_id: string; subject: string; to_emails: string[]; cnt: bigint; ids: string[]; mids: (string | null)[]; pids: string[]; ats: Date[] }[]
  >`
    SELECT account_id, subject, to_emails, count(*) as cnt,
           array_agg(id) as ids, array_agg(message_id_header) as mids,
           array_agg(provider_message_id) as pids, array_agg(received_at) as ats
    FROM inbound_email_messages
    WHERE folder = 'SENT'
    GROUP BY account_id, subject, to_emails
    HAVING count(*) > 1
    ORDER BY count(*) DESC
    LIMIT 30
  `;
  console.log(`Found ${rows.length} subject+recipient group(s) with more than one SENT row.`);
  for (const r of rows) {
    console.log(
      `\naccount=${r.account_id} subject="${r.subject}" to=${r.to_emails.join(",")} count=${r.cnt}\n` +
        `  ids=${r.ids.join(", ")}\n` +
        `  messageIdHeaders=${r.mids.map((m) => m ?? "null").join(" | ")}\n` +
        `  providerMessageIds=${r.pids.join(" | ")}\n` +
        `  receivedAt=${r.ats.map((a) => new Date(a).toISOString()).join(" | ")}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
