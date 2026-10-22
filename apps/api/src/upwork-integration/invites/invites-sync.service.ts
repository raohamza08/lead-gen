import { Injectable, Logger } from "@nestjs/common";
import { UpworkApiConnection } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { UpworkGraphQLClient, VENDOR_INVITATION_STATUS_FILTERS, VendorInvitationNode, VendorInvitationStatusFilter } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";

/** Confirmed live: vendorInvitations rejects `first` above 40 ("query param
 *  limit can not be greater than 40") — a different, higher cap than
 *  vendorProposals' 25, confirmed empirically the same way. */
const PAGE_SIZE = 40;
/** Hard ceiling on pages fetched per status filter per sync tick, same
 *  safety reasoning as UpworkProposalsSyncService's own cap. 200 pages *
 *  40/page = 8,000 invitations per status per tick, far beyond EurosHub's
 *  real volume (352 terminated + 0 pending at build time). */
const MAX_PAGES_PER_STATUS = 200;

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Actual Invites sync logic (Part: Upwork API integration — Invites domain,
 * 2026-10-22, built specifically because the user explicitly required bids
 * and invites to be stored/shown as separate domains, not merged into one
 * "proposals" bucket) — same split as UpworkProposalsSyncService/Worker:
 * this owns "talk to Upwork + upsert into Postgres" for one connection, the
 * worker just loops over every CONNECTED connection and calls this.
 *
 * `organization.vendorInvitations` only exposes a coarse `status_eq` filter
 * ("pending"/"terminated" — see VENDOR_INVITATION_STATUS_FILTERS), not the
 * full 5-value lifecycle status — so this walks both filter values every
 * tick, always a full bounded walk per status (no early-stop — see
 * UpworkProposalsSyncService's docblock for why an early-stop on
 * already-seen rows is unsafe against partial prior syncs; same reasoning
 * applies here from the start rather than needing a later retrofit).
 *
 * Uses UpworkApiConnectionService.withFreshTokenOnAuthFailure from the
 * start (same reactive-refresh fix as Connects usage/Proposals — see
 * either of their docblocks for the real bug this avoids).
 */
@Injectable()
export class UpworkInvitesSyncService {
  private readonly logger = new Logger(UpworkInvitesSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
  ) {}

  async syncConnection(connectionRow: UpworkApiConnection): Promise<void> {
    try {
      await this.connection.withFreshTokenOnAuthFailure(connectionRow.orgId, async ({ accessToken, organizationId }) => {
        for (const status of VENDOR_INVITATION_STATUS_FILTERS) {
          await this.syncStatus(connectionRow.orgId, accessToken, organizationId, status);
        }
      });
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (err) {
      const message = (err as Error).message.slice(0, 300);
      this.logger.warn(`Invites sync failed for org ${connectionRow.orgId}: ${message}`);
      await this.prisma.upworkApiConnection.update({
        where: { id: connectionRow.id },
        data: { lastSyncError: message },
      });
      throw err;
    }
  }

  private async syncStatus(
    orgId: string,
    accessToken: string,
    organizationId: string | null,
    status: VendorInvitationStatusFilter,
  ): Promise<void> {
    let after: string | null = null;
    let pages = 0;
    do {
      const page = await this.graphql.getVendorInvitationsPage(accessToken, organizationId, status, after, PAGE_SIZE);
      if (!page.invitations.length) break;

      await this.prisma.$transaction(page.invitations.map((i) => this.upsertInvite(orgId, i)));

      pages += 1;
      after = page.endCursor;
      if (!page.hasNextPage) break;
    } while (after && pages < MAX_PAGES_PER_STATUS);
  }

  private upsertInvite(orgId: string, i: VendorInvitationNode) {
    const data = {
      context: i.context,
      clientUserId: i.client?.user?.id ?? null,
      clientName: i.client?.user?.name ?? null,
      freelancerUserId: i.freelancer?.user?.id ?? null,
      freelancerName: i.freelancer?.user?.name ?? null,
      jobId: i.jobPosting?.id ?? null,
      jobTitle: i.jobPosting?.content?.title ?? null,
      invitationLetter: i.invitationLetter ?? null,
      inviteAttempt: i.inviteAttempt ?? null,
      status: i.statusDetails?.status ?? null,
      acceptanceDuration: i.acceptanceDetails?.duration ?? null,
      upfrontPaymentPct: i.acceptanceDetails?.upfrontPaymentPercent ?? null,
      coverLetter: i.acceptanceDetails?.coverLetter ?? null,
      upworkCreatedBy: i.auditDetails?.createdBy ?? null,
      upworkCreatedAt: toDate(i.auditDetails?.createdDateTime),
      upworkModifiedBy: i.auditDetails?.modifiedBy ?? null,
      upworkModifiedAt: toDate(i.auditDetails?.modifiedDateTime),
    };
    return this.prisma.upworkApiInvite.upsert({
      where: { orgId_upworkInvitationId: { orgId, upworkInvitationId: i.id } },
      create: { orgId, upworkInvitationId: i.id, ...data },
      update: data,
    });
  }
}
