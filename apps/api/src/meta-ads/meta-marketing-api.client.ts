import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** Thrown for every non-2xx or `{error: {...}}` response from the Marketing
 *  API — never swallowed into a generic Error, since callers (the sync
 *  worker, the manual-sync endpoint) need to tell "token is dead, mark the
 *  account ERROR and ask the user to reconnect" (code 190) apart from "we
 *  got rate limited, try again next tick" (codes 4/17/32/613) apart from
 *  everything else (Part: Error Handling — no raw API error surfaced to the
 *  user; this is what a caller translates into a friendly message from). */
export class MetaApiError extends Error {
  readonly code?: number;
  readonly subcode?: number;
  readonly type?: string;
  readonly fbtraceId?: string;

  constructor(message: string, code?: number, subcode?: number, type?: string, fbtraceId?: string) {
    super(message);
    this.code = code;
    this.subcode = subcode;
    this.type = type;
    this.fbtraceId = fbtraceId;
  }

  /** OAuthException — the token is invalid, revoked, or expired. Reconnect
   *  is the only fix; retrying on the next sync tick will never succeed. */
  get isAuthError(): boolean {
    return this.code === 190;
  }

  /** Meta's several distinct rate-limit codes, collapsed into one check —
   *  a caller should back off and retry later, not mark the account broken. */
  get isRateLimited(): boolean {
    return this.code === 4 || this.code === 17 || this.code === 32 || this.code === 613;
  }
}

export interface MetaAdAccountDto {
  id: string; // "act_123..."
  name: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
  business?: { id: string; name: string };
}

export interface MetaCampaignDto {
  id: string;
  name: string;
  effective_status: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  buying_type?: string;
  start_time?: string;
  stop_time?: string;
}

export interface MetaAdSetDto {
  id: string;
  name: string;
  campaign_id: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  optimization_goal?: string;
  billing_event?: string;
  start_time?: string;
  end_time?: string;
}

export interface MetaAdDto {
  id: string;
  name: string;
  adset_id: string;
  effective_status: string;
  creative?: { id: string; thumbnail_url?: string };
}

export interface MetaActionValue {
  action_type: string;
  value: string;
}

export interface MetaInsightRowDto {
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  date_start: string;
  date_stop: string;
  impressions?: string;
  reach?: string;
  frequency?: string;
  clicks?: string;
  inline_link_clicks?: string;
  spend?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  account_currency?: string;
  actions?: MetaActionValue[];
  action_values?: MetaActionValue[];
  cost_per_action_type?: MetaActionValue[];
  purchase_roas?: MetaActionValue[];
}

const INSIGHT_FIELDS = [
  "campaign_id",
  "adset_id",
  "ad_id",
  "date_start",
  "date_stop",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "spend",
  "ctr",
  "cpc",
  "cpm",
  "account_currency",
  "actions",
  "action_values",
  "cost_per_action_type",
  "purchase_roas",
].join(",");

/** Every request against Meta's Marketing API — thin fetch wrapper, no
 *  business logic (upserting into our own tables is MetaAdsSyncService's
 *  job, not this client's). Mirrors the shape of the existing social-media
 *  providers (one client, all HTTP concerns in one place) but is NOT a
 *  SocialPlatformProvider — Ads reporting has nothing in common with that
 *  interface's publish/DM/comment surface (Part: standing decision, Meta
 *  Ads is its own connection). */
@Injectable()
export class MetaMarketingApiClient {
  constructor(private readonly config: ConfigService) {}

  private graphVersion(): string {
    return this.config.get<string>("META_GRAPH_API_VERSION", "v21.0");
  }

  private baseUrl(): string {
    return `https://graph.facebook.com/${this.graphVersion()}`;
  }

  /** Every Marketing API call funnels through here so error normalization
   *  (Meta puts errors in the JSON body, not just the HTTP status — a 400
   *  and a 200-with-error-field both happen depending on the endpoint) only
   *  has to be right in one place. */
  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = `${this.baseUrl()}${path}?${new URLSearchParams(params).toString()}`;
    const res = await fetch(url);
    const body = (await res.json()) as T & { error?: { message: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string } };
    if (body.error) {
      throw new MetaApiError(body.error.message, body.error.code, body.error.error_subcode, body.error.type, body.error.fbtrace_id);
    }
    if (!res.ok) {
      throw new MetaApiError(`Meta API request failed: ${res.status}`);
    }
    return body;
  }

  /** Follows `paging.next` verbatim rather than reconstructing cursor params
   *  ourselves — Meta's own next-page URL already carries every param
   *  (including the access token) it needs. Capped at 50 pages as a safety
   *  net against a runaway loop on a malformed response; no real ad
   *  account's campaign/ad-set/ad list or a single sync window's daily
   *  insights should ever approach that. */
  private async paginate<T>(firstUrl: string): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | undefined = firstUrl;
    let pages = 0;
    while (nextUrl && pages < 50) {
      const res = await fetch(nextUrl);
      const body = (await res.json()) as {
        data?: T[];
        paging?: { next?: string };
        error?: { message: string; type?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
      };
      if (body.error) {
        throw new MetaApiError(body.error.message, body.error.code, body.error.error_subcode, body.error.type, body.error.fbtrace_id);
      }
      if (!res.ok) throw new MetaApiError(`Meta API request failed: ${res.status}`);
      results.push(...(body.data ?? []));
      nextUrl = body.paging?.next;
      pages += 1;
    }
    return results;
  }

  getOAuthUrl(clientId: string, state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      // ads_read is the minimum grant for read-only reporting (Part: Meta
      // Ads module) -- deliberately NOT requesting ads_management or
      // business_management here. Meta rejects the ENTIRE OAuth request if
      // any one requested scope isn't approved for the app (same "Invalid
      // Scopes" failure mode facebook.provider.ts already documents live),
      // so starting from the smallest working grant and adding more only
      // once confirmed approved is the safer order.
      scope: "ads_read",
      response_type: "code",
    });
    return `https://www.facebook.com/${this.graphVersion()}/dialog/oauth?${params.toString()}`;
  }

  async exchangeCodeForToken(clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<{ accessToken: string; expiresInSec?: number }> {
    const body = await this.request<{ access_token: string; expires_in?: number }>("/oauth/access_token", {
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    });
    return { accessToken: body.access_token, expiresInSec: body.expires_in };
  }

  /** Short-lived user tokens (~1-2h) are useless for a background sync —
   *  every connect exchanges immediately for the long-lived (~60 day)
   *  variant, same `fb_exchange_token` grant MetaTokenRefreshWorker later
   *  re-runs before expiry. */
  async exchangeForLongLivedToken(clientId: string, clientSecret: string, shortLivedToken: string): Promise<{ accessToken: string; expiresInSec?: number }> {
    const body = await this.request<{ access_token: string; expires_in?: number }>("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: shortLivedToken,
    });
    return { accessToken: body.access_token, expiresInSec: body.expires_in };
  }

  async listAdAccounts(accessToken: string): Promise<MetaAdAccountDto[]> {
    const url = `${this.baseUrl()}/me/adaccounts?${new URLSearchParams({
      fields: "id,name,currency,timezone_name,account_status,business{id,name}",
      limit: "200",
      access_token: accessToken,
    }).toString()}`;
    return this.paginate<MetaAdAccountDto>(url);
  }

  async listCampaigns(accessToken: string, adAccountId: string): Promise<MetaCampaignDto[]> {
    const url = `${this.baseUrl()}/${adAccountId}/campaigns?${new URLSearchParams({
      fields: "id,name,effective_status,objective,daily_budget,lifetime_budget,buying_type,start_time,stop_time",
      limit: "200",
      access_token: accessToken,
    }).toString()}`;
    return this.paginate<MetaCampaignDto>(url);
  }

  async listAdSets(accessToken: string, adAccountId: string): Promise<MetaAdSetDto[]> {
    const url = `${this.baseUrl()}/${adAccountId}/adsets?${new URLSearchParams({
      fields: "id,name,campaign_id,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,start_time,end_time",
      limit: "200",
      access_token: accessToken,
    }).toString()}`;
    return this.paginate<MetaAdSetDto>(url);
  }

  async listAds(accessToken: string, adAccountId: string): Promise<MetaAdDto[]> {
    const url = `${this.baseUrl()}/${adAccountId}/ads?${new URLSearchParams({
      fields: "id,name,adset_id,effective_status,creative{id,thumbnail_url}",
      limit: "200",
      access_token: accessToken,
    }).toString()}`;
    return this.paginate<MetaAdDto>(url);
  }

  /** One call per sync window, at the finest level (`level=ad`,
   *  `time_increment=1`) -- see schema.prisma's own comment on
   *  MetaAdInsightDaily for why this is the only Insights call the whole
   *  module ever makes. `since`/`until` are "YYYY-MM-DD". */
  async getDailyInsights(accessToken: string, adAccountId: string, since: string, until: string): Promise<MetaInsightRowDto[]> {
    const url = `${this.baseUrl()}/${adAccountId}/insights?${new URLSearchParams({
      level: "ad",
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      fields: INSIGHT_FIELDS,
      limit: "500",
      access_token: accessToken,
    }).toString()}`;
    return this.paginate<MetaInsightRowDto>(url);
  }
}
