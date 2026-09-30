import { Injectable, Logger } from "@nestjs/common";
import { MetaAdAccount, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { EncryptionService } from "../common/crypto/encryption.service";
import { MetaApiError, MetaInsightRowDto, MetaMarketingApiClient } from "./meta-marketing-api.client";

/** Prisma's Json input type wants a plain index-signature object, not our
 *  typed `MetaActionValue[]` — this is a real array of real Meta data, so a
 *  cast through `unknown` is the correct tool here, not a reshape. */
function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  return value === undefined ? undefined : (value as Prisma.InputJsonValue);
}

const FIRST_SYNC_LOOKBACK_DAYS = 37; // covers the dashboard's default 30-day window plus room for a trailing comparison period
const ROLLING_SYNC_LOOKBACK_DAYS = 3; // re-pulls a few trailing days every tick to catch Meta's late attribution updates, not just "today"

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function actionValue(actions: { action_type: string; value: string }[] | undefined, type: string): number | undefined {
  const row = actions?.find((a) => a.action_type === type);
  return row ? Number(row.value) : undefined;
}

/** Owns the actual "talk to Meta, upsert into our tables" work for one ad
 *  account — called both by MetaAdsSyncWorker's repeatable tick (every
 *  connected account) and the manual "Sync now" controller endpoint (one
 *  account, on demand), so the two paths can never drift into different
 *  upsert logic. */
@Injectable()
export class MetaAdsSyncService {
  private readonly logger = new Logger(MetaAdsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly client: MetaMarketingApiClient,
  ) {}

  async syncAccount(account: MetaAdAccount): Promise<void> {
    if (!account.accessTokenEnc) {
      throw new Error("Account has no stored access token — reconnect it.");
    }
    const accessToken = this.encryption.decrypt(account.accessTokenEnc);

    try {
      const [campaigns, adSets, ads] = await Promise.all([
        this.client.listCampaigns(accessToken, account.externalAccountId),
        this.client.listAdSets(accessToken, account.externalAccountId),
        this.client.listAds(accessToken, account.externalAccountId),
      ]);

      const campaignIdByExternal = new Map<string, string>();
      for (const c of campaigns) {
        const row = await this.prisma.metaCampaign.upsert({
          where: { adAccountId_externalCampaignId: { adAccountId: account.id, externalCampaignId: c.id } },
          create: {
            adAccountId: account.id,
            externalCampaignId: c.id,
            name: c.name,
            status: c.effective_status,
            objective: c.objective,
            dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : undefined,
            lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : undefined,
            buyingType: c.buying_type,
            startTime: c.start_time ? new Date(c.start_time) : undefined,
            stopTime: c.stop_time ? new Date(c.stop_time) : undefined,
          },
          update: {
            name: c.name,
            status: c.effective_status,
            objective: c.objective,
            dailyBudget: c.daily_budget ? Number(c.daily_budget) / 100 : undefined,
            lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : undefined,
            buyingType: c.buying_type,
            startTime: c.start_time ? new Date(c.start_time) : undefined,
            stopTime: c.stop_time ? new Date(c.stop_time) : undefined,
          },
        });
        campaignIdByExternal.set(c.id, row.id);
      }

      const adSetIdByExternal = new Map<string, string>();
      for (const s of adSets) {
        const campaignId = campaignIdByExternal.get(s.campaign_id);
        if (!campaignId) continue; // orphaned ad set (campaign outside this account's list) — skip rather than guess
        const row = await this.prisma.metaAdSet.upsert({
          where: { campaignId_externalAdSetId: { campaignId, externalAdSetId: s.id } },
          create: {
            campaignId,
            externalAdSetId: s.id,
            name: s.name,
            status: s.effective_status,
            dailyBudget: s.daily_budget ? Number(s.daily_budget) / 100 : undefined,
            lifetimeBudget: s.lifetime_budget ? Number(s.lifetime_budget) / 100 : undefined,
            optimizationGoal: s.optimization_goal,
            billingEvent: s.billing_event,
            startTime: s.start_time ? new Date(s.start_time) : undefined,
            endTime: s.end_time ? new Date(s.end_time) : undefined,
          },
          update: {
            name: s.name,
            status: s.effective_status,
            dailyBudget: s.daily_budget ? Number(s.daily_budget) / 100 : undefined,
            lifetimeBudget: s.lifetime_budget ? Number(s.lifetime_budget) / 100 : undefined,
            optimizationGoal: s.optimization_goal,
            billingEvent: s.billing_event,
            startTime: s.start_time ? new Date(s.start_time) : undefined,
            endTime: s.end_time ? new Date(s.end_time) : undefined,
          },
        });
        adSetIdByExternal.set(s.id, row.id);
      }

      const adIdByExternal = new Map<string, string>();
      for (const a of ads) {
        const adSetId = adSetIdByExternal.get(a.adset_id);
        if (!adSetId) continue;
        const row = await this.prisma.metaAd.upsert({
          where: { adSetId_externalAdId: { adSetId, externalAdId: a.id } },
          create: {
            adSetId,
            externalAdId: a.id,
            name: a.name,
            status: a.effective_status,
            creativeId: a.creative?.id,
            thumbnailUrl: a.creative?.thumbnail_url,
          },
          update: {
            name: a.name,
            status: a.effective_status,
            creativeId: a.creative?.id,
            thumbnailUrl: a.creative?.thumbnail_url,
          },
        });
        adIdByExternal.set(a.id, row.id);
      }

      const lookbackDays = account.lastSyncAt ? ROLLING_SYNC_LOOKBACK_DAYS : FIRST_SYNC_LOOKBACK_DAYS;
      const until = new Date();
      const since = new Date(until.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
      const insights = await this.client.getDailyInsights(accessToken, account.externalAccountId, toDateStr(since), toDateStr(until));

      await this.upsertInsights(account.id, campaignIdByExternal, adSetIdByExternal, adIdByExternal, insights);

      await this.prisma.metaAdAccount.update({
        where: { id: account.id },
        data: { status: "CONNECTED", lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (err) {
      await this.recordSyncFailure(account.id, err as Error);
      throw err;
    }
  }

  private async upsertInsights(
    adAccountId: string,
    campaignIdByExternal: Map<string, string>,
    adSetIdByExternal: Map<string, string>,
    adIdByExternal: Map<string, string>,
    rows: MetaInsightRowDto[],
  ) {
    for (const row of rows) {
      const adId = row.ad_id ? adIdByExternal.get(row.ad_id) : undefined;
      if (!adId) continue; // an insight row for an ad this sync's /ads listing didn't return — skip rather than store a dangling reference
      const campaignId = row.campaign_id ? campaignIdByExternal.get(row.campaign_id) : undefined;
      const adSetId = row.adset_id ? adSetIdByExternal.get(row.adset_id) : undefined;

      await this.prisma.metaAdInsightDaily.upsert({
        where: { adId_date: { adId, date: new Date(row.date_start) } },
        create: {
          adAccountId,
          campaignId,
          adSetId,
          adId,
          date: new Date(row.date_start),
          impressions: row.impressions ? Number(row.impressions) : 0,
          reach: row.reach ? Number(row.reach) : 0,
          frequency: row.frequency ? Number(row.frequency) : undefined,
          clicks: row.clicks ? Number(row.clicks) : 0,
          linkClicks: row.inline_link_clicks ? Number(row.inline_link_clicks) : undefined,
          spend: row.spend ? Number(row.spend) : 0,
          ctr: row.ctr ? Number(row.ctr) : undefined,
          cpc: row.cpc ? Number(row.cpc) : undefined,
          cpm: row.cpm ? Number(row.cpm) : undefined,
          videoViews: actionValue(row.actions, "video_view"),
          landingPageViews: actionValue(row.actions, "landing_page_view"),
          actions: asJson(row.actions),
          actionValues: asJson(row.action_values),
          costPerActionType: asJson(row.cost_per_action_type),
          purchaseRoas: asJson(row.purchase_roas),
          currency: row.account_currency,
        },
        update: {
          campaignId,
          adSetId,
          impressions: row.impressions ? Number(row.impressions) : 0,
          reach: row.reach ? Number(row.reach) : 0,
          frequency: row.frequency ? Number(row.frequency) : undefined,
          clicks: row.clicks ? Number(row.clicks) : 0,
          linkClicks: row.inline_link_clicks ? Number(row.inline_link_clicks) : undefined,
          spend: row.spend ? Number(row.spend) : 0,
          ctr: row.ctr ? Number(row.ctr) : undefined,
          cpc: row.cpc ? Number(row.cpc) : undefined,
          cpm: row.cpm ? Number(row.cpm) : undefined,
          videoViews: actionValue(row.actions, "video_view"),
          landingPageViews: actionValue(row.actions, "landing_page_view"),
          actions: asJson(row.actions),
          actionValues: asJson(row.action_values),
          costPerActionType: asJson(row.cost_per_action_type),
          purchaseRoas: asJson(row.purchase_roas),
          currency: row.account_currency,
        },
      });
    }
  }

  /** Auth failures (dead/revoked token) get a distinct status from every
   *  other failure (rate limit, transient network blip) — EXPIRED tells the
   *  UI "reconnect is the only fix," ERROR tells it "this will likely
   *  recover on its own next tick" (Part: Error Handling). */
  private async recordSyncFailure(accountId: string, err: Error) {
    const isAuthError = err instanceof MetaApiError && err.isAuthError;
    this.logger.warn(`Meta Ads sync failed for account ${accountId}: ${err.message}`);
    await this.prisma.metaAdAccount.update({
      where: { id: accountId },
      data: {
        status: isAuthError ? "EXPIRED" : "ERROR",
        lastSyncError: isAuthError ? "Access token expired or was revoked — reconnect this account." : err.message.slice(0, 500),
      },
    });
  }
}
