import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { MetaAdsService } from "./meta-ads.service";
import { MetaAdsSyncService } from "./meta-ads-sync.service";
import { MetaAdsAnalyticsService } from "./meta-ads-analytics.service";
import { SelectMetaAdAccountsDto, DateRangeQueryDto, TimeseriesQueryDto, ListCampaignsQueryDto, ListAdSetsQueryDto, ListAdsQueryDto } from "./dto/meta-ads.dto";

@Controller("meta-ads")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("META_ADS")
export class MetaAdsController {
  constructor(
    private readonly service: MetaAdsService,
    private readonly sync: MetaAdsSyncService,
    private readonly analytics: MetaAdsAnalyticsService,
  ) {}

  /** Starting a connect is a privileged, org-wide credential grant — same
   *  ADMIN-only gate as SocialMediaController's own connect endpoint. */
  @Get("oauth/url")
  @Roles(Role.ADMIN)
  getOAuthUrl(@CurrentUser() user: JwtClaims) {
    return this.service.initiateConnect(user);
  }

  @Get("pending/:pendingId")
  getPendingSelection(@CurrentUser() user: JwtClaims, @Param("pendingId") pendingId: string) {
    return this.service.getPendingSelection(user, pendingId);
  }

  @Post("accounts/select")
  @Roles(Role.ADMIN)
  selectAdAccounts(@CurrentUser() user: JwtClaims, @Body() dto: SelectMetaAdAccountsDto) {
    return this.service.selectAdAccounts(user, dto);
  }

  @Get("accounts")
  listAccounts(@CurrentUser() user: JwtClaims) {
    return this.service.listAccounts(user.orgId);
  }

  @Delete("accounts/:id")
  @Roles(Role.ADMIN)
  disconnect(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.disconnectAccount(user, id);
  }

  /** Synchronous "Sync now" — a handful of paginated Marketing API calls,
   *  bounded well within a normal request timeout; simpler than routing a
   *  one-off job through the repeatable-tick queue for a single account. */
  @Post("accounts/:id/sync")
  async syncNow(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    const account = await this.service.getOwnedAccount(user.orgId, id);
    await this.sync.syncAccount(account);
    return this.service.listAccounts(user.orgId);
  }

  @Get("accounts/:id/overview")
  getOverview(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Query() query: DateRangeQueryDto) {
    return this.analytics.getOverview(user.orgId, id, query);
  }

  @Get("accounts/:id/timeseries")
  getTimeseries(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Query() query: TimeseriesQueryDto) {
    return this.analytics.getTimeseries(user.orgId, id, query);
  }

  @Get("accounts/:id/campaigns")
  listCampaigns(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Query() query: ListCampaignsQueryDto) {
    return this.analytics.listCampaigns(user.orgId, id, query);
  }

  @Get("accounts/:id/adsets")
  listAdSets(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Query() query: ListAdSetsQueryDto) {
    return this.analytics.listAdSets(user.orgId, id, query);
  }

  @Get("accounts/:id/ads")
  listAds(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Query() query: ListAdsQueryDto) {
    return this.analytics.listAds(user.orgId, id, query);
  }
}
