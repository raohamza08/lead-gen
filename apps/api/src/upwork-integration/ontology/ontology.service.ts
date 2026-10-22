import { Injectable } from "@nestjs/common";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/** 24h -- this is Upwork's own static taxonomy, same reasoning as
 *  UpworkCommonEntitiesService's own cache. */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** ontologySkills has thousands of entries -- confirmed real IDs like
 *  "kg:30-10000" running into high numbers; cap at a reasonable page for
 *  a reference browser rather than pulling the entire taxonomy. */
const SKILLS_LIMIT = 500;

/**
 * Ontology & Reference Data (spec Module F) — LIVE (Part: Upwork API
 * integration — Ontology domain, 2026-10-23). Confirmed real: 12 top-level
 * categories, skills taxonomy with real ontologyId/preferredLabel/
 * definition fields. In-process cache, same reasoning as
 * UpworkCommonEntitiesService — static reference data other modules
 * should reference, not operational data to mix into dashboards.
 */
@Injectable()
export class UpworkOntologyService {
  private cache: { categories?: unknown; skills?: unknown; fetchedAt: number } = { fetchedAt: 0 };

  constructor(
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  private isFresh(): boolean {
    return Date.now() - this.cache.fetchedAt < CACHE_TTL_MS;
  }

  async getAll(orgId: string) {
    if (this.isFresh() && this.cache.categories && this.cache.skills) {
      return { categories: this.cache.categories, skills: this.cache.skills, cachedAt: new Date(this.cache.fetchedAt) };
    }
    return this.connection.withFreshTokenOnAuthFailure(orgId, async ({ accessToken, organizationId }) => {
      const [categories, skills] = await Promise.all([
        this.graphql.getOntologyCategories(accessToken, organizationId),
        this.graphql.getOntologySkills(accessToken, organizationId, SKILLS_LIMIT),
      ]);
      this.cache = { categories, skills, fetchedAt: Date.now() };
      return { categories, skills, cachedAt: new Date(this.cache.fetchedAt) };
    });
  }
}
