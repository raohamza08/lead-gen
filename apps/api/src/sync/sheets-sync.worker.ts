import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Job, Worker } from "bullmq";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { SHEETS_COLUMNS, leadToSheetRow } from "./sheets-columns";
import { GoogleSheetsClient } from "./google-sheets.client";

/**
 * Appends one row per lead to the org's Google Sheet (Part C4/F5). Batches are
 * naturally small here (one job per lead) — Sheets API quota (300 writes/
 * min/project) is respected by the queue's concurrency, not by batching writes
 * client-side in this scaffold. A production version should coalesce N pending
 * jobs into one values.append call when queue depth is high.
 */
@Injectable()
export class SheetsSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SheetsSyncWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly sheetsClient: GoogleSheetsClient,
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      QUEUE_NAMES.SHEETS_SYNC,
      (job) => this.handle(job),
      { connection: getRedisConnection(), concurrency: 5 },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async handle(job: Job<{ leadId: string }>) {
    const lead = await this.prisma.lead.findUniqueOrThrow({
      where: { id: job.data.leadId },
      include: { score: true, pipelineState: true, assignedUser: true },
    });

    const row = leadToSheetRow(lead as any);
    const spreadsheetId = this.config.get<string>("GOOGLE_SHEETS_SPREADSHEET_ID");
    const tabName = lead.industry ?? "General";
    const existing = await this.prisma.sheetsSync.findUnique({ where: { leadId: lead.id } });

    if (!spreadsheetId || !this.sheetsClient.isConfigured()) {
      this.logger.warn(`Sheets not configured — skipping real write, row=${JSON.stringify(row)}`);
      if (!existing) {
        const rowNumber = (await this.prisma.sheetsSync.count({})) + 2; // +1 header, +1 for 1-indexing
        await this.prisma.sheetsSync.create({ data: { leadId: lead.id, rowNumber } });
      }
      return;
    }

    // "update-row" (stage-change driven) piggybacks on the same append-once
    // row — if the initial append job hasn't landed yet, fall through and
    // append instead so we never lose the row entirely.
    if (job.name === "update-row" && existing) {
      await this.sheetsClient.updateRow(spreadsheetId, tabName, existing.rowNumber, row);
      await this.prisma.sheetsSync.update({ where: { leadId: lead.id }, data: { lastSyncedAt: new Date() } });
      return;
    }

    if (!existing) {
      const rowNumber = await this.sheetsClient.appendRow(spreadsheetId, tabName, row);
      await this.prisma.sheetsSync.create({ data: { leadId: lead.id, rowNumber: rowNumber || 0 } });
      this.logger.log(`Appended row for lead ${lead.id} to sheet ${spreadsheetId} tab="${tabName}"`);
    } else {
      await this.sheetsClient.updateRow(spreadsheetId, tabName, existing.rowNumber, row);
      await this.prisma.sheetsSync.update({ where: { leadId: lead.id }, data: { lastSyncedAt: new Date() } });
    }
  }
}

export { SHEETS_COLUMNS };
