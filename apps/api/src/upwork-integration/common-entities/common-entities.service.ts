import { Injectable } from "@nestjs/common";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/** 24h -- this is Upwork's own static reference data (country/language/
 *  region lists), not agency-specific or fast-changing; re-fetching every
 *  request would be wasteful. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Common Entities (spec Module M) — LIVE (Part: Upwork API integration —
 * Common Entities domain, 2026-10-23). Confirmed real: 254 countries, 150
 * languages, 28 regions. Simple in-process cache rather than a Prisma
 * table — this is Upwork's own static reference data, not something this
 * app needs to version or query historically; other modules should
 * reference these values (e.g. a country ID on a freelancer profile)
 * rather than storing their own copy of the name/region/etc, per the
 * spec's explicit "reuse common entities through normalized references"
 * requirement.
 */
@Injectable()
export class UpworkCommonEntitiesService {
  private cache: { countries?: unknown; languages?: unknown; regions?: unknown; fetchedAt: number } = { fetchedAt: 0 };

  constructor(
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  private isFresh(): boolean {
    return Date.now() - this.cache.fetchedAt < CACHE_TTL_MS;
  }

  async getAll(orgId: string) {
    if (this.isFresh() && this.cache.countries && this.cache.languages && this.cache.regions) {
      return { countries: this.cache.countries, languages: this.cache.languages, regions: this.cache.regions, cachedAt: new Date(this.cache.fetchedAt) };
    }
    return this.connection.withFreshTokenOnAuthFailure(orgId, async ({ accessToken, organizationId }) => {
      const [countries, languages, regions] = await Promise.all([
        this.graphql.getCountries(accessToken, organizationId),
        this.graphql.getLanguages(accessToken, organizationId),
        this.graphql.getRegions(accessToken, organizationId),
      ]);
      this.cache = { countries, languages, regions, fetchedAt: Date.now() };
      return { countries, languages, regions, cachedAt: new Date(this.cache.fetchedAt) };
    });
  }
}
