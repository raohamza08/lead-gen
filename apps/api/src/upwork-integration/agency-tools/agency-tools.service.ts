import { BadRequestException, Injectable } from "@nestjs/common";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { PrismaService } from "../../common/prisma/prisma.service";

/**
 * Agency Tools (Part: Upwork API integration — companySelector/Talent
 * Search/Work Diary/Team Invite, 2026-10-23) — four small, real Upwork
 * capabilities discovered via live schema introspection that weren't
 * built yet. Deliberately grouped into one domain module rather than
 * four separate ones (unlike the rest of this app's one-module-per-
 * domain convention) — each is small, read-mostly, and gated the same
 * way (primary-admin only, not the standard module-access flag system —
 * explicit user request, "keep it to me for now... do not change any
 * settings" — until a decision is made on who else should see these).
 */
@Injectable()
export class UpworkAgencyToolsService {
  constructor(
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
    private readonly prisma: PrismaService,
  ) {}

  /** Every real Upwork org/account this connection's user belongs to —
   *  lets a picker show all options instead of the OAuth connect flow's
   *  own silent "first item" default. */
  async listOrganizations(orgId: string) {
    const { accessToken } = await this.connection.getValidAccessToken(orgId);
    return this.graphql.listOrganizations(accessToken);
  }

  /** Public talent search by keyword — see UpworkGraphQLClient.
   *  searchFreelancerTalent's own docblock for the confirmed-live field
   *  limitations (shortName + ciphertext only; no skills/rate/location
   *  through this specific query). */
  async searchTalent(orgId: string, keyword: string, first: number, after: string | null) {
    if (!keyword.trim()) throw new BadRequestException("A search keyword is required.");
    return this.connection.withFreshTokenOnAuthFailure(orgId, ({ accessToken, organizationId }) =>
      this.graphql.searchFreelancerTalent(accessToken, organizationId, keyword.trim(), first, after),
    );
  }

  /** Contracts available to inspect in Work Diary — reuses the already-
   *  synced Work History table rather than a new Upwork query, so this
   *  never costs an extra API call. */
  async listContractsForWorkDiary(orgId: string) {
    const entries = await this.prisma.upworkApiWorkHistoryEntry.findMany({
      where: { orgId },
      orderBy: { startDate: "desc" },
      take: 100,
      select: { upworkContractId: true, title: true, freelancerName: true, status: true },
    });
    return entries;
  }

  /** Real per-contract work diary for one date (YYYY-MM-DD from the
   *  frontend, converted to Upwork's required YYYYMMDD here) — see
   *  UpworkGraphQLClient.getWorkDiaryContract's own docblock for why
   *  this is distinct from (and not blocked like) contractTimeReport. */
  async getWorkDiary(orgId: string, contractId: string, dateISO: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) throw new BadRequestException("date must be YYYY-MM-DD");
    const dateYYYYMMDD = dateISO.replaceAll("-", "");
    const diary = await this.connection.withFreshTokenOnAuthFailure(orgId, ({ accessToken, organizationId }) =>
      this.graphql.getWorkDiaryContract(accessToken, organizationId, contractId, dateYYYYMMDD),
    );
    return (
      diary ?? {
        workDiaryMetadata: null,
        workDiaryTimeCells: [],
      }
    );
  }

  /** Sends a real invitation email inviting someone to join this
   *  agency's Upwork team — a genuine, irreversible side effect once
   *  called (unlike every other method on this service, which only
   *  reads). See UpworkGraphQLClient.inviteToTeam's own docblock —
   *  schema-verified via introspection, never test-executed with a
   *  real email. */
  async inviteToTeam(orgId: string, email: string, targetOrganizationId: string, landingUrl: string) {
    if (!email.includes("@")) throw new BadRequestException("A valid email address is required.");
    if (!landingUrl.startsWith("http")) throw new BadRequestException("landingUrl must be a full URL.");
    return this.connection.withFreshTokenOnAuthFailure(orgId, ({ accessToken, organizationId }) =>
      this.graphql.inviteToTeam(accessToken, organizationId, email.trim(), targetOrganizationId, landingUrl.trim()),
    );
  }
}
