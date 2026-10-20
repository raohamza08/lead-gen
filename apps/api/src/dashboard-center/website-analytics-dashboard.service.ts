import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { google, analyticsdata_v1beta } from "googleapis";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { decodeServiceAccountKey } from "../common/google-service-account";
import { DashboardRangeQuery, resolveDashboardRange, percentDelta } from "./dashboard-center.util";

/**
 * Website Analytics — real GA4 data via the Google Analytics Data API
 * (Part: Dashboard Center, 2026-10-20, explicit user request — "i have a
 * website and i want to see its stats here on outly... connected to
 * analytics.google.com"). Auth is a read-only service account, the same
 * GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64 pair
 * google-sheets.client.ts already uses — one shared service-account
 * identity, scoped per request (this file requests analytics.readonly,
 * that file requests spreadsheets; a single service account can hold both
 * without conflict). Deliberately NOT the Meta Ads OAuth-connect pattern:
 * neither a working Google OAuth client ID/secret nor an existing service
 * account was actually configured in this deployment (checked both --both
 * were empty), and a read-only service account needs no consent screen or
 * Google app verification, just the org granting it Viewer access inside
 * GA4's own Property Access Management screen. The GA4 Property ID itself
 * (not secret) lives in Organization.settings, same as every other
 * org-level setting (see organization.service.ts); the service-account
 * credential is infra-level and stays in .env, not the database.
 */

const SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"];

export interface GaOverview {
  totalUsers: number;
  sessions: number;
  pageViews: number;
  engagementRate?: number;
  avgSessionSeconds?: number;
  previousTotalUsers?: number;
  totalUsersDeltaPct: number | null;
  sessionsDeltaPct: number | null;
  pageViewsDeltaPct: number | null;
}

export interface GaTimeseriesPoint {
  date: string;
  totalUsers: number;
  sessions: number;
  pageViews: number;
  avgSessionSeconds: number;
  engagementRate: number;
}

export interface GaBreakdownRow {
  label: string;
  value: number;
}

export interface GaPageRow {
  path: string;
  views: number;
}

@Injectable()
export class WebsiteAnalyticsDashboardService {
  private readonly logger = new Logger(WebsiteAnalyticsDashboardService.name);
  private client?: analyticsdata_v1beta.Analyticsdata;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  isCredentialConfigured(): boolean {
    return Boolean(
      this.config.get<string>("GOOGLE_SERVICE_ACCOUNT_EMAIL") &&
        this.config.get<string>("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64"),
    );
  }

  async getPropertyId(orgId: string): Promise<string | null> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const settings = (org.settings as Record<string, unknown>) ?? {};
    return (settings.gaPropertyId as string) || null;
  }

  async setPropertyId(orgId: string, propertyId: string): Promise<{ propertyId: string }> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const settings = { ...(org.settings as Record<string, unknown>), gaPropertyId: propertyId.trim() };
    await this.prisma.organization.update({ where: { id: orgId }, data: { settings: settings as Prisma.InputJsonValue } });
    return { propertyId: propertyId.trim() };
  }

  private getClient(): analyticsdata_v1beta.Analyticsdata {
    if (!this.client) {
      const email = this.config.get<string>("GOOGLE_SERVICE_ACCOUNT_EMAIL");
      const privateKey = decodeServiceAccountKey(this.config.get<string>("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY_B64", ""));
      const auth = new google.auth.JWT({ email, key: privateKey, scopes: SCOPES });
      this.client = google.analyticsdata({ version: "v1beta", auth });
    }
    return this.client;
  }

  /** `undefined` means "not set up yet" — callers render a connect/empty
   *  state rather than erroring, same convention as Meta Ads' `connected`
   *  flag. */
  async getConnectionStatus(orgId: string): Promise<{ connected: boolean; propertyId: string | null }> {
    const propertyId = await this.getPropertyId(orgId);
    return { connected: this.isCredentialConfigured() && Boolean(propertyId), propertyId };
  }

  private fmt(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private async runReport(
    propertyId: string,
    from: Date,
    to: Date,
    dimensions: string[],
    metrics: string[],
    orderByDimension?: string,
    limit?: number,
  ): Promise<analyticsdata_v1beta.Schema$RunReportResponse> {
    try {
      const res = await this.getClient().properties.runReport({
        property: `properties/${propertyId}`,
        requestBody: {
          dateRanges: [{ startDate: this.fmt(from), endDate: this.fmt(to) }],
          dimensions: dimensions.map((name) => ({ name })),
          metrics: metrics.map((name) => ({ name })),
          orderBys: orderByDimension
            ? [{ dimension: { dimensionName: orderByDimension } }]
            : metrics.length
              ? [{ metric: { metricName: metrics[0] }, desc: true }]
              : undefined,
          limit: limit ? String(limit) : undefined,
        },
      });
      return res.data;
    } catch (err) {
      this.logger.error(`GA4 runReport failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        `Could not reach Google Analytics: ${(err as Error).message}. Check the service account has Viewer access on this GA4 property.`,
      );
    }
  }

  private num(row: analyticsdata_v1beta.Schema$Row | undefined, metricIndex: number): number {
    const v = row?.metricValues?.[metricIndex]?.value;
    return v !== undefined ? Number(v) : 0;
  }

  async getOverview(orgId: string, query: DashboardRangeQuery): Promise<GaOverview> {
    const propertyId = await this.getPropertyId(orgId);
    if (!propertyId) throw new ServiceUnavailableException("No GA4 property connected yet.");
    const { current, previous } = resolveDashboardRange(query);
    const metrics = ["totalUsers", "sessions", "screenPageViews", "engagementRate", "averageSessionDuration"];

    const [currentRes, previousRes] = await Promise.all([
      this.runReport(propertyId, current.from, current.to, [], metrics),
      previous ? this.runReport(propertyId, previous.from, previous.to, [], metrics) : Promise.resolve(undefined),
    ]);

    const row = currentRes.rows?.[0];
    const prevRow = previousRes?.rows?.[0];
    const totalUsers = this.num(row, 0);
    const sessions = this.num(row, 1);
    const pageViews = this.num(row, 2);
    const previousTotalUsers = previousRes ? this.num(prevRow, 0) : undefined;

    return {
      totalUsers,
      sessions,
      pageViews,
      engagementRate: row?.metricValues?.[3]?.value !== undefined ? Number(row.metricValues[3].value) * 100 : undefined,
      avgSessionSeconds: row?.metricValues?.[4]?.value !== undefined ? Number(row.metricValues[4].value) : undefined,
      previousTotalUsers,
      totalUsersDeltaPct: previous ? percentDelta(totalUsers, previousTotalUsers) : null,
      sessionsDeltaPct: previous ? percentDelta(sessions, this.num(prevRow, 1)) : null,
      pageViewsDeltaPct: previous ? percentDelta(pageViews, this.num(prevRow, 2)) : null,
    };
  }

  async getTimeseries(orgId: string, query: DashboardRangeQuery): Promise<GaTimeseriesPoint[]> {
    const propertyId = await this.getPropertyId(orgId);
    if (!propertyId) throw new ServiceUnavailableException("No GA4 property connected yet.");
    const { current } = resolveDashboardRange(query);
    // avgSessionSeconds/engagementRate added alongside the original three
    // (Part: Dashboard Center, 2026-10-20, explicit user request — "i want
    // the dashboards like this one", a reference screenshot with a
    // per-metric trend card for every KPI, including avg session). One
    // report call covers all five metrics in lockstep per day, so the four
    // per-metric trend cards on the frontend share this single fetch
    // rather than issuing their own requests.
    const res = await this.runReport(
      propertyId,
      current.from,
      current.to,
      ["date"],
      ["totalUsers", "sessions", "screenPageViews", "averageSessionDuration", "engagementRate"],
      "date",
    );
    return (res.rows ?? []).map((r) => {
      const raw = r.dimensionValues?.[0]?.value ?? "";
      // GA4 returns dates as YYYYMMDD with no separators.
      const date = raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw;
      return {
        date,
        totalUsers: this.num(r, 0),
        sessions: this.num(r, 1),
        pageViews: this.num(r, 2),
        avgSessionSeconds: this.num(r, 3),
        engagementRate: this.num(r, 4) * 100,
      };
    });
  }

  async getTrafficSources(orgId: string, query: DashboardRangeQuery): Promise<GaBreakdownRow[]> {
    const propertyId = await this.getPropertyId(orgId);
    if (!propertyId) throw new ServiceUnavailableException("No GA4 property connected yet.");
    const { current } = resolveDashboardRange(query);
    const res = await this.runReport(propertyId, current.from, current.to, ["sessionDefaultChannelGroup"], ["sessions"]);
    return (res.rows ?? []).map((r) => ({ label: r.dimensionValues?.[0]?.value || "(unassigned)", value: this.num(r, 0) }));
  }

  async getTopPages(orgId: string, query: DashboardRangeQuery, limit = 10): Promise<GaPageRow[]> {
    const propertyId = await this.getPropertyId(orgId);
    if (!propertyId) throw new ServiceUnavailableException("No GA4 property connected yet.");
    const { current } = resolveDashboardRange(query);
    const res = await this.runReport(propertyId, current.from, current.to, ["pagePath"], ["screenPageViews"], undefined, limit);
    return (res.rows ?? []).map((r) => ({ path: r.dimensionValues?.[0]?.value || "/", views: this.num(r, 0) }));
  }

  async getAudience(orgId: string, query: DashboardRangeQuery): Promise<{ devices: GaBreakdownRow[]; countries: GaBreakdownRow[] }> {
    const propertyId = await this.getPropertyId(orgId);
    if (!propertyId) throw new ServiceUnavailableException("No GA4 property connected yet.");
    const { current } = resolveDashboardRange(query);
    const [devicesRes, countriesRes] = await Promise.all([
      this.runReport(propertyId, current.from, current.to, ["deviceCategory"], ["sessions"]),
      this.runReport(propertyId, current.from, current.to, ["country"], ["sessions"], undefined, 10),
    ]);
    return {
      devices: (devicesRes.rows ?? []).map((r) => ({ label: r.dimensionValues?.[0]?.value || "(unknown)", value: this.num(r, 0) })),
      countries: (countriesRes.rows ?? []).map((r) => ({ label: r.dimensionValues?.[0]?.value || "(unknown)", value: this.num(r, 0) })),
    };
  }
}
