import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { google, sheets_v4 } from "googleapis";
import { SHEETS_COLUMNS } from "./sheets-columns";

/**
 * Thin wrapper around the Sheets API v4 (Part C4): service-account auth,
 * one tab per niche, header row created on first write to a new tab. Kept
 * separate from the worker so the worker stays testable without a live
 * Google credential.
 */
@Injectable()
export class GoogleSheetsClient {
  private readonly logger = new Logger(GoogleSheetsClient.name);
  private sheetsApi?: sheets_v4.Sheets;
  private readonly knownTabs = new Set<string>();

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>("GOOGLE_SERVICE_ACCOUNT_EMAIL") &&
        this.config.get<string>("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"),
    );
  }

  private getClient(): sheets_v4.Sheets {
    if (!this.sheetsApi) {
      const email = this.config.get<string>("GOOGLE_SERVICE_ACCOUNT_EMAIL");
      const privateKey = this.config
        .get<string>("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "")
        .replace(/\\n/g, "\n");

      const auth = new google.auth.JWT({
        email,
        key: privateKey,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
      this.sheetsApi = google.sheets({ version: "v4", auth });
    }
    return this.sheetsApi;
  }

  /** Ensures a tab exists for this niche and has the Part F5 header row written. */
  private async ensureTab(spreadsheetId: string, tabName: string): Promise<void> {
    const cacheKey = `${spreadsheetId}:${tabName}`;
    if (this.knownTabs.has(cacheKey)) return;

    const sheets = this.getClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const exists = meta.data.sheets?.some((s) => s.properties?.title === tabName);

    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [[...SHEETS_COLUMNS]] },
      });
      this.logger.log(`Created new Sheets tab "${tabName}" with header row`);
    }
    this.knownTabs.add(cacheKey);
  }

  /** Append-only from the platform's perspective (Part C4) — Sheets is an export/audit surface. */
  async appendRow(spreadsheetId: string, tabName: string, row: (string | number)[]): Promise<number> {
    await this.ensureTab(spreadsheetId, tabName);
    const sheets = this.getClient();
    const result = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${tabName}!A:A`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });
    const updatedRange = result.data.updates?.updatedRange ?? "";
    const match = updatedRange.match(/![A-Z]+(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  /** Writes back a status update (e.g. stage change) to a previously-appended row without a full rewrite. */
  async updateRow(spreadsheetId: string, tabName: string, rowNumber: number, row: (string | number)[]): Promise<void> {
    await this.ensureTab(spreadsheetId, tabName);
    const sheets = this.getClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  }
}
