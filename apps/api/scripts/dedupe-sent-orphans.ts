/**
 * Second-pass cleanup for pre-fix Sent-view duplicates (Part: Email Hub
 * Sent-view duplicate fix, 2026-09-02) — dedupe-sent-messages.ts only
 * matches duplicates sharing an identical messageIdHeader, which the fixed
 * code always produces going forward. But duplicates created *before* the
 * fix don't share that field: the placeholder row (written instantly on
 * send) stored nodemailer's own fabricated id as messageIdHeader, while the
 * real synced copy has whatever id MailComposer generated independently —
 * two different values for the same email. Confirmed live: two rows named
 * "hshshsh"/"subject given", same account/subject/recipient, received ~1
 * second apart, with completely different messageIdHeaders.
 *
 * A leftover placeholder is identifiable on its own: its providerMessageId
 * is still the Message-ID string (`<...>`), never promoted to a real
 * numeric IMAP UID, because EmailHubSyncWorker's exact-messageIdHeader
 * promotion check (correctly) never found a match for it. This finds each
 * such placeholder, looks for a same-account/subject/recipients SENT row
 * with a real numeric providerMessageId received within +/-30 minutes (the
 * closest match, if several), merges isImportant/isIgnored/tags onto that
 * real row, and deletes the placeholder. A placeholder with no matching
 * sibling in the window is left alone — it's the only copy of that email,
 * not a duplicate (possibly just not synced back yet).
 *
 *   npx ts-node --transpile-only apps/api/scripts/dedupe-sent-orphans.ts --dry-run
 *   npx ts-node --transpile-only apps/api/scripts/dedupe-sent-orphans.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");
const WINDOW_MS = 30 * 60 * 1000;

function isNumericUid(providerMessageId: string): boolean {
  return /^\d+$/.test(providerMessageId);
}

async function main() {
  const sentRows = await prisma.inboundEmailMessage.findMany({
    where: { folder: "SENT" },
    include: { tags: true },
  });
  const placeholders = sentRows.filter((r) => !isNumericUid(r.providerMessageId));
  console.log(`${sentRows.length} SENT row(s) total, ${placeholders.length} unpromoted placeholder(s).`);

  let deleted = 0;
  let skipped = 0;

  for (const p of placeholders) {
    const candidates = sentRows.filter(
      (r) =>
        r.id !== p.id &&
        isNumericUid(r.providerMessageId) &&
        r.accountId === p.accountId &&
        r.subject === p.subject &&
        JSON.stringify(r.toEmails) === JSON.stringify(p.toEmails) &&
        Math.abs(r.receivedAt.getTime() - p.receivedAt.getTime()) <= WINDOW_MS,
    );
    if (candidates.length === 0) {
      console.log(`  [skip] ${p.id} "${p.subject}" -> ${p.toEmails.join(",")} — no numeric sibling within 30min, leaving alone.`);
      skipped++;
      continue;
    }
    candidates.sort((a, b) => Math.abs(a.receivedAt.getTime() - p.receivedAt.getTime()) - Math.abs(b.receivedAt.getTime() - p.receivedAt.getTime()));
    const real = candidates[0];

    console.log(
      `  [match] placeholder=${p.id} <-> real=${real.id} "${p.subject}" -> ${p.toEmails.join(",")} ` +
        `(${Math.round(Math.abs(real.receivedAt.getTime() - p.receivedAt.getTime()) / 1000)}s apart)`,
    );

    if (DRY_RUN) continue;

    const mergedIsImportant = p.isImportant || real.isImportant;
    const mergedIsIgnored = p.isIgnored || real.isIgnored;
    const realTagIds = new Set(real.tags.map((t) => t.tagId));
    const tagsToAdd = p.tags.map((t) => t.tagId).filter((id) => !realTagIds.has(id));

    await prisma.$transaction(async (tx) => {
      if (mergedIsImportant !== real.isImportant || mergedIsIgnored !== real.isIgnored) {
        await tx.inboundEmailMessage.update({
          where: { id: real.id },
          data: { isImportant: mergedIsImportant, isIgnored: mergedIsIgnored },
        });
      }
      for (const tagId of tagsToAdd) {
        await tx.inboundEmailMessageTag.create({ data: { messageId: real.id, tagId } }).catch(() => {});
      }
      await tx.inboundEmailMessage.delete({ where: { id: p.id } });
    });
    deleted++;
  }

  console.log(`\n${DRY_RUN ? "[dry run] Would delete" : "Deleted"} ${placeholders.length - skipped} placeholder row(s), left ${skipped} unmatched.`);
  if (!DRY_RUN) console.log(`Actually deleted: ${deleted}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
