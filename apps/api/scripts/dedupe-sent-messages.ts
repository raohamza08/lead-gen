/**
 * One-off cleanup for the Sent-view duplicate bug fixed in
 * email-provider.interface.ts's ensureMessageId (Part: Email Hub Sent-view
 * duplicate fix, 2026-09-02). Before that fix, SmtpProvider/GmailProvider
 * could return a providerMessageId that didn't match the real Message-ID
 * header embedded in the sent email, so EmailHubSyncWorker's
 * messageIdHeader-based promotion check never recognized the instantly-
 * written Sent-view row as "already recorded" and inserted a second one.
 * This finds every (accountId, messageIdHeader) group with more than one
 * SENT-folder row, keeps the one with a real (numeric) IMAP UID as
 * providerMessageId — the fully-synced copy — merges any isImportant/
 * isIgnored/tags a user may have set on either duplicate onto the keeper so
 * no user action is silently lost, and deletes the rest.
 *
 * Run with --dry-run first to see what would happen with no writes.
 * Not wired into any build/deploy step — invoke manually:
 *   npx ts-node --transpile-only apps/api/scripts/dedupe-sent-messages.ts --dry-run
 *   npx ts-node --transpile-only apps/api/scripts/dedupe-sent-messages.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

function isNumericUid(providerMessageId: string): boolean {
  return /^\d+$/.test(providerMessageId);
}

async function main() {
  const dupes = await prisma.$queryRaw<{ account_id: string; message_id_header: string; ids: string[] }[]>`
    SELECT account_id, message_id_header, array_agg(id ORDER BY created_at ASC) AS ids
    FROM inbound_email_messages
    WHERE folder = 'SENT' AND message_id_header IS NOT NULL
    GROUP BY account_id, message_id_header
    HAVING count(*) > 1
  `;

  console.log(`Found ${dupes.length} duplicate group(s).`);
  if (dupes.length === 0) return;

  let deletedTotal = 0;

  for (const group of dupes) {
    const rows = await prisma.inboundEmailMessage.findMany({
      where: { id: { in: group.ids } },
      include: { tags: true },
      orderBy: { createdAt: "asc" },
    });

    const keeper = rows.find((r) => isNumericUid(r.providerMessageId)) ?? rows[0];
    const losers = rows.filter((r) => r.id !== keeper.id);

    const mergedIsImportant = rows.some((r) => r.isImportant);
    const mergedIsIgnored = rows.some((r) => r.isIgnored);
    const loserTagIds = new Set(losers.flatMap((r) => r.tags.map((t) => t.tagId)));
    const keeperTagIds = new Set(keeper.tags.map((t) => t.tagId));
    const tagsToAdd = [...loserTagIds].filter((id) => !keeperTagIds.has(id));

    console.log(
      `\nGroup: account=${group.account_id} messageId=${group.message_id_header}\n` +
        `  keeper=${keeper.id} (providerMessageId=${keeper.providerMessageId}, subject="${keeper.subject}")\n` +
        `  losers=${losers.map((r) => `${r.id} (providerMessageId=${r.providerMessageId})`).join(", ")}\n` +
        `  merge: isImportant=${mergedIsImportant} isIgnored=${mergedIsIgnored} +${tagsToAdd.length} tag(s)`,
    );

    if (DRY_RUN) continue;

    await prisma.$transaction(async (tx) => {
      if (mergedIsImportant !== keeper.isImportant || mergedIsIgnored !== keeper.isIgnored) {
        await tx.inboundEmailMessage.update({
          where: { id: keeper.id },
          data: { isImportant: mergedIsImportant, isIgnored: mergedIsIgnored },
        });
      }
      for (const tagId of tagsToAdd) {
        await tx.inboundEmailMessageTag.create({ data: { messageId: keeper.id, tagId } }).catch(() => {});
      }
      await tx.inboundEmailMessage.deleteMany({ where: { id: { in: losers.map((r) => r.id) } } });
    });

    deletedTotal += losers.length;
  }

  const wouldDelete = dupes.reduce((n, g) => n + g.ids.length - 1, 0);
  console.log(`\n${DRY_RUN ? "[dry run] Would delete" : "Deleted"} ${wouldDelete} duplicate row(s) across ${dupes.length} group(s).`);
  if (!DRY_RUN) console.log(`Actually deleted: ${deletedTotal}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
