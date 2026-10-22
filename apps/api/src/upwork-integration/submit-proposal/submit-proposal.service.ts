import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../common/prisma/prisma.service";
import { UpworkGraphQLClient } from "../shared/upwork-graphql.client";
import { UpworkApiConnectionService } from "../connection/upwork-api-connection.service";
import { AuditLogService } from "../../audit-log/audit-log.service";
import { SubmitProposalDto } from "./submit-proposal.dto";

/**
 * Submit Proposals to Jobs (spec Module Q) — LIVE, real mutation, real
 * Connects spend (Part: Upwork API integration — Submit Proposals
 * domain, 2026-10-23). Schema confirmed via introspection (see
 * UpworkGraphQLClient.createJobProposal's own docblock) — this is the
 * highest-risk write in the whole integration, built last among the
 * write modules per the original plan.
 *
 * Requires `confirmed: true` in the request body — this is the "final
 * review and explicit user confirmation" step the spec requires; a
 * request without it is rejected with no Upwork API call made at all.
 * Every real attempt (success or failure) is recorded in the audit log,
 * with a local duplicate-submission guard keyed on jobReference +
 * selectedContractorId so a retried request can't double-submit by
 * accident.
 */
@Injectable()
export class UpworkSubmitProposalService {
  private readonly logger = new Logger(UpworkSubmitProposalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connection: UpworkApiConnectionService,
    private readonly graphql: UpworkGraphQLClient,
    private readonly auditLog: AuditLogService,
  ) {}

  async submit(orgId: string, userId: string, dto: SubmitProposalDto) {
    if (!dto.confirmed) {
      throw new BadRequestException("Proposal submission requires explicit confirmation (confirmed: true) after final review -- this spends real Connects and submits a real bid.");
    }

    const existing = await this.prisma.upworkApiSubmittedProposal.findFirst({
      where: { orgId, jobReference: dto.jobReference, selectedContractorId: dto.selectedContractorId },
    });
    if (existing) {
      throw new BadRequestException(`A proposal for this job/contractor was already submitted (Upwork proposal ID: ${existing.upworkProposalId ?? "unknown"}, at ${existing.createdAt.toISOString()}) -- refusing to submit a duplicate.`);
    }

    return this.connection.withFreshTokenOnAuthFailure(orgId, async ({ accessToken, organizationId }) => {
      if (!organizationId) {
        throw new BadRequestException("No organization ID configured for this connection -- cannot determine teamOrgId for submission.");
      }
      let result: { newProposalId: string | null; status: string | null; error: string | null };
      try {
        result = await this.graphql.createJobProposal(accessToken, organizationId, {
          selectedContractor: { id: dto.selectedContractorId, oDeskUserID: dto.oDeskUserID },
          jobReference: dto.jobReference,
          chargedAmount: dto.chargedAmount,
          coverLetter: dto.coverLetter,
          teamOrgId: organizationId,
          occupationId: dto.occupationId,
          estimatedDuration: dto.estimatedDuration,
          questions: dto.questions,
          attachments: dto.attachments,
        });
      } catch (err) {
        this.auditLog.write({
          orgId,
          actorId: userId,
          action: "UPWORK_API_PROPOSAL_SUBMIT_FAILED",
          entityType: "upworkApiProposal",
          result: "FAILURE",
          metadata: { jobReference: dto.jobReference, selectedContractorId: dto.selectedContractorId, error: (err as Error).message },
        });
        throw err;
      }

      await this.prisma.upworkApiSubmittedProposal.create({
        data: {
          orgId,
          jobReference: dto.jobReference,
          selectedContractorId: dto.selectedContractorId,
          upworkProposalId: result.newProposalId,
          status: result.status,
          error: result.error,
        },
      });
      this.auditLog.write({
        orgId,
        actorId: userId,
        action: "UPWORK_API_PROPOSAL_SUBMITTED",
        entityType: "upworkApiProposal",
        entityId: result.newProposalId ?? undefined,
        metadata: { jobReference: dto.jobReference, upworkProposalId: result.newProposalId, status: result.status },
      });
      this.logger.log(`Proposal submitted for org ${orgId}: job ${dto.jobReference}, result ${JSON.stringify(result)}`);
      return result;
    });
  }
}
