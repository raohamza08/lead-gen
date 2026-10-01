import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { NotificationCategory, Prisma, UpworkAccountType, UpworkProposalStatus, UpworkProposalType, UpworkRequestStatus } from "@prisma/client";
import { Role } from "@leadgen/types";
import { PrismaService } from "../common/prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { resolveDateRange, ResolvedDateRange } from "../analytics/date-range";
import { CreateUpworkRequestDto } from "./dto/create-upwork-request.dto";
import { UpdateUpworkRequestDto } from "./dto/update-upwork-request.dto";
import { ReviewUpworkRequestDto } from "./dto/review-upwork-request.dto";
import { QueryUpworkRequestsDto } from "./dto/query-upwork-requests.dto";
import { QueryUpworkWeekDto } from "./dto/query-upwork-week.dto";

const REVIEWER_ROLES: Role[] = [Role.ADMIN, Role.BUSINESS_DEVELOPER];
const CAN_SEE_ALL_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.BUSINESS_DEVELOPER];

/**
 * Project Manager hour requests against Upwork profiles/IDs, their review
 * workflow, and the reporting that ties them back to real onboarded hours
 * (Part: Upwork Requests, 2026-10-01). Lives alongside UpworkService in the
 * same module/table family — see UpworkRequest's own schema docblock for why
 * this is a dedicated model rather than folded into UpworkProposal.
 */
@Injectable()
export class UpworkRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Profile access (which IDs/profiles a Project Manager may request) ----

  /** All profile names in the org's picklist (Part: Upwork Proposals,
   *  2026-09-29 — same `organization.settings.upworkPicklists` blob the
   *  Bidding/Invite forms read from), filtered down to whatever this user is
   *  explicitly granted. Zero grant rows means unrestricted — see
   *  UpworkProfileAccess's own schema docblock for why that's the chosen
   *  default rather than locking out every new Project Manager by default. */
  async listAvailableProfiles(orgId: string, userId: string): Promise<string[]> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
    const settings = (org?.settings as Record<string, unknown>) ?? {};
    const allProfiles = ((settings.upworkPicklists as { profiles?: string[] } | undefined)?.profiles) ?? [];

    const grants = await this.prisma.upworkProfileAccess.findMany({ where: { userId }, select: { profileName: true } });
    if (grants.length === 0) return allProfiles;

    const grantedLower = new Set(grants.map((g) => g.profileName.toLowerCase()));
    return allProfiles.filter((p) => grantedLower.has(p.toLowerCase()));
  }

  private assertNoDuplicateProfiles(items: { profileName: string }[]) {
    const seen = new Set<string>();
    for (const item of items) {
      const key = item.profileName.trim().toLowerCase();
      if (seen.has(key)) throw new BadRequestException(`"${item.profileName}" was selected more than once in this request.`);
      seen.add(key);
    }
  }

  /** Checked against the request's OWNER (the Project Manager the request
   *  belongs to), never the editor — an admin editing someone else's draft
   *  must still respect that person's own allow-list. */
  private async assertProfilesAllowed(orgId: string, projectManagerId: string, items: { profileName: string }[]) {
    const available = await this.listAvailableProfiles(orgId, projectManagerId);
    const availableLower = new Set(available.map((p) => p.toLowerCase()));
    const disallowed = items.map((i) => i.profileName).filter((p) => !availableLower.has(p.toLowerCase()));
    if (disallowed.length > 0) {
      throw new ForbiddenException(`Not allowed to request hours against: ${disallowed.join(", ")}`);
    }
  }

  // ---- CRUD + workflow ----

  async create(orgId: string, userId: string, dto: CreateUpworkRequestDto) {
    this.assertNoDuplicateProfiles(dto.items);
    await this.assertProfilesAllowed(orgId, userId, dto.items);

    const status = dto.status === "DRAFT" ? UpworkRequestStatus.DRAFT : UpworkRequestStatus.SUBMITTED;
    const totalRequestedHours = dto.items.reduce((sum, i) => sum + i.requestedHours, 0);

    const request = await this.prisma.upworkRequest.create({
      data: {
        orgId,
        projectManagerId: userId,
        requestDate: new Date(dto.requestDate),
        status,
        notes: dto.notes,
        totalRequestedHours,
        items: { create: dto.items.map((i) => ({ profileName: i.profileName.trim(), requestedHours: i.requestedHours })) },
      },
      include: { items: true, projectManager: { select: { id: true, name: true } } },
    });

    if (status === UpworkRequestStatus.SUBMITTED) {
      await this.notifyReviewers(orgId, request.id, userId);
    }
    return request;
  }

  async findAll(orgId: string, requesterId: string, requesterRole: Role, query: QueryUpworkRequestsDto) {
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize ?? "50", 10) || 50));
    const canSeeAll = CAN_SEE_ALL_ROLES.includes(requesterRole);

    const where: Prisma.UpworkRequestWhereInput = {
      orgId,
      ...(canSeeAll ? (query.projectManagerId ? { projectManagerId: query.projectManagerId } : {}) : { projectManagerId: requesterId }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? { requestDate: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.upworkRequest.count({ where }),
      this.prisma.upworkRequest.findMany({
        where,
        include: {
          items: true,
          projectManager: { select: { id: true, name: true } },
          reviewedByUser: { select: { id: true, name: true } },
        },
        orderBy: { requestDate: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { items, total, page, pageSize };
  }

  async findOne(orgId: string, requesterId: string, requesterRole: Role, id: string) {
    const request = await this.prisma.upworkRequest.findFirst({
      where: { id, orgId },
      include: {
        items: true,
        projectManager: { select: { id: true, name: true } },
        reviewedByUser: { select: { id: true, name: true } },
      },
    });
    if (!request) throw new NotFoundException("Request not found");
    if (request.projectManagerId !== requesterId && !CAN_SEE_ALL_ROLES.includes(requesterRole)) {
      throw new ForbiddenException("You can only view your own requests.");
    }
    return request;
  }

  async update(orgId: string, requesterId: string, requesterRole: Role, id: string, dto: UpdateUpworkRequestDto) {
    const existing = await this.prisma.upworkRequest.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException("Request not found");

    const isOwner = existing.projectManagerId === requesterId;
    if (!isOwner && requesterRole !== Role.ADMIN) {
      throw new ForbiddenException("Only the request's own Project Manager (or an admin) can edit it.");
    }
    if (existing.status !== UpworkRequestStatus.DRAFT && existing.status !== UpworkRequestStatus.SUBMITTED) {
      throw new ForbiddenException("This request is already under review and can no longer be edited.");
    }

    if (dto.items) {
      this.assertNoDuplicateProfiles(dto.items);
      await this.assertProfilesAllowed(orgId, existing.projectManagerId, dto.items);
    }

    const totalRequestedHours = dto.items ? dto.items.reduce((sum, i) => sum + i.requestedHours, 0) : undefined;

    return this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.upworkRequestItem.deleteMany({ where: { requestId: id } });
        await tx.upworkRequestItem.createMany({
          data: dto.items.map((i) => ({ requestId: id, profileName: i.profileName.trim(), requestedHours: i.requestedHours })),
        });
      }
      return tx.upworkRequest.update({
        where: { id },
        data: {
          ...(dto.requestDate ? { requestDate: new Date(dto.requestDate) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(totalRequestedHours !== undefined ? { totalRequestedHours } : {}),
        },
        include: { items: true, projectManager: { select: { id: true, name: true } } },
      });
    });
  }

  /** Separate from `update` so "save as draft, come back later" and "submit
   *  now" are two distinct, intentional actions rather than inferring intent
   *  from a status field buried in a generic PATCH body. */
  async submit(orgId: string, requesterId: string, id: string) {
    const existing = await this.prisma.upworkRequest.findFirst({ where: { id, orgId }, include: { items: true } });
    if (!existing) throw new NotFoundException("Request not found");
    if (existing.projectManagerId !== requesterId) throw new ForbiddenException("Only the request's own Project Manager can submit it.");
    if (existing.status !== UpworkRequestStatus.DRAFT) throw new BadRequestException("Only a draft request can be submitted.");
    if (existing.items.length === 0) throw new BadRequestException("Add at least one profile/ID before submitting.");

    const updated = await this.prisma.upworkRequest.update({ where: { id }, data: { status: UpworkRequestStatus.SUBMITTED } });
    await this.notifyReviewers(orgId, id, requesterId);
    return updated;
  }

  async review(orgId: string, reviewerId: string, id: string, dto: ReviewUpworkRequestDto) {
    const existing = await this.prisma.upworkRequest.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException("Request not found");

    const nextStatus = dto.status as UpworkRequestStatus;
    // A reviewer only ever moves a request forward -- never back to an
    // author-only state (DRAFT/SUBMITTED), and never skips from APPROVED
    // straight past COMPLETED or re-opens a REJECTED one.
    const validTransitions: Partial<Record<UpworkRequestStatus, UpworkRequestStatus[]>> = {
      [UpworkRequestStatus.SUBMITTED]: [UpworkRequestStatus.UNDER_REVIEW, UpworkRequestStatus.APPROVED, UpworkRequestStatus.REJECTED],
      [UpworkRequestStatus.UNDER_REVIEW]: [UpworkRequestStatus.APPROVED, UpworkRequestStatus.REJECTED],
      [UpworkRequestStatus.APPROVED]: [UpworkRequestStatus.COMPLETED],
    };
    const allowed = validTransitions[existing.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException(`Cannot move a ${existing.status} request to ${nextStatus}.`);
    }

    const updated = await this.prisma.upworkRequest.update({
      where: { id },
      data: {
        status: nextStatus,
        reviewedByUserId: reviewerId,
        reviewNotes: dto.reviewNotes ?? existing.reviewNotes,
        reviewedAt: new Date(),
      },
    });

    if (nextStatus === UpworkRequestStatus.APPROVED || nextStatus === UpworkRequestStatus.REJECTED) {
      await this.notifications.notify(orgId, {
        category: NotificationCategory.UPWORK,
        type: nextStatus === UpworkRequestStatus.APPROVED ? "UPWORK_REQUEST_APPROVED" : "UPWORK_REQUEST_REJECTED",
        title: nextStatus === UpworkRequestStatus.APPROVED ? "Your Upwork hour request was approved" : "Your Upwork hour request was rejected",
        message:
          dto.reviewNotes ||
          (nextStatus === UpworkRequestStatus.APPROVED
            ? "It now counts toward your weekly target."
            : "No review notes were left."),
        actionUrl: "/upwork/requests",
        severity: "WARNING",
        entityType: "upworkRequest",
        entityId: id,
        recipientUserIds: [existing.projectManagerId],
      });
    }

    return updated;
  }

  async remove(orgId: string, requesterId: string, requesterRole: Role, id: string) {
    const existing = await this.prisma.upworkRequest.findFirst({ where: { id, orgId } });
    if (!existing) throw new NotFoundException("Request not found");

    const isOwner = existing.projectManagerId === requesterId;
    if (!isOwner && requesterRole !== Role.ADMIN) {
      throw new ForbiddenException("Only the request's own Project Manager (or an admin) can delete it.");
    }
    if (existing.status !== UpworkRequestStatus.DRAFT && requesterRole !== Role.ADMIN) {
      throw new ForbiddenException("Only a draft request can be deleted — ask an admin to withdraw it after submission.");
    }

    await this.prisma.upworkRequest.delete({ where: { id } });
    return { deleted: true };
  }

  private async notifyReviewers(orgId: string, requestId: string, submitterId: string) {
    const [submitter, reviewers] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: submitterId }, select: { name: true } }),
      this.prisma.user.findMany({ where: { orgId, active: true, role: { in: REVIEWER_ROLES } }, select: { id: true } }),
    ]);
    const recipientUserIds = reviewers.map((r) => r.id);
    if (recipientUserIds.length === 0) return;

    await this.notifications.notify(orgId, {
      category: NotificationCategory.UPWORK,
      type: "UPWORK_REQUEST_SUBMITTED",
      title: "New Upwork hour request submitted",
      message: `${submitter?.name ?? "A project manager"} submitted a new hour request for review.`,
      actionUrl: "/upwork/requests",
      severity: "WARNING",
      entityType: "upworkRequest",
      entityId: requestId,
      recipientUserIds,
    });
  }

  // ---- Reporting: weekly target, Request vs Achievement, dashboard summary ----

  private resolveRange(query: QueryUpworkWeekDto): ResolvedDateRange {
    return resolveDateRange(query.range ?? "THIS_WEEK", new Date(), query.from, query.to);
  }

  /** Real onboarded hours in `range`, grouped by profile name (Part: spec
   *  section 15 — "use the actual Project Hours stored against projects, do
   *  not calculate from number of bids/invites"). `profileNamesLower`
   *  undefined = every profile org-wide; an explicit empty array = scoped to
   *  nothing (correctly returns zero hours rather than silently falling back
   *  to unscoped — used when a Project Manager has zero approved requests in
   *  the period). Training-account bids are excluded, same convention as
   *  UpworkService.getStats's own liveOnly filter — a practice bid was never
   *  real onboarded work. */
  private async sumOnboardedHoursByProfile(
    orgId: string,
    range: ResolvedDateRange,
    profileNamesLower?: string[],
  ): Promise<Map<string, { bidding: number; invites: number }>> {
    const result = new Map<string, { bidding: number; invites: number }>();
    if (profileNamesLower && profileNamesLower.length === 0) return result;

    const rows = await this.prisma.upworkProposal.findMany({
      where: {
        orgId,
        status: UpworkProposalStatus.WON,
        onboardedAt: { gte: range.from, lte: range.to },
        projectHours: { not: null },
        OR: [{ type: UpworkProposalType.INVITE }, { type: UpworkProposalType.BIDDING, accountType: UpworkAccountType.LIVE }],
      },
      select: { type: true, profileName: true, projectHours: true },
    });

    const filterSet = profileNamesLower ? new Set(profileNamesLower) : undefined;
    for (const r of rows) {
      const key = r.profileName.toLowerCase();
      if (filterSet && !filterSet.has(key)) continue;
      const entry = result.get(key) ?? { bidding: 0, invites: 0 };
      if (r.type === UpworkProposalType.BIDDING) entry.bidding += r.projectHours ?? 0;
      else entry.invites += r.projectHours ?? 0;
      result.set(key, entry);
    }
    return result;
  }

  /**
   * "Requested Hours: 100 / Bidding Hours Onboarded: 65 / Invite Hours
   * Onboarded: 20 / Total Hours Onboarded: 85 / Remaining Hours: 15" (Part:
   * spec section 4). Achievement is matched by profile name against
   * whichever profiles appear in this PM's APPROVED requests for the period
   * — there's no other link between a Project Manager and a Bidding/Invite
   * row (UpworkProposal.submittedBy is a free-text name, not a User
   * relation; see that field's own schema docblock), so profile identity is
   * the only honest join key available.
   */
  async getWeeklyTarget(orgId: string, requesterId: string, requesterRole: Role, query: QueryUpworkWeekDto) {
    const range = this.resolveRange(query);
    const projectManagerId = requesterRole === Role.PROJECT_MANAGER ? requesterId : query.projectManagerId;

    const approvedItems = await this.prisma.upworkRequestItem.findMany({
      where: {
        request: {
          orgId,
          status: UpworkRequestStatus.APPROVED,
          requestDate: { gte: range.from, lte: range.to },
          ...(projectManagerId ? { projectManagerId } : {}),
        },
      },
      select: { profileName: true, requestedHours: true },
    });

    const requestedHours = approvedItems.reduce((sum, i) => sum + i.requestedHours, 0);
    const profileNamesLower = [...new Set(approvedItems.map((i) => i.profileName.toLowerCase()))];

    const byProfile = await this.sumOnboardedHoursByProfile(orgId, range, profileNamesLower);
    let biddingHoursOnboarded = 0;
    let inviteHoursOnboarded = 0;
    for (const v of byProfile.values()) {
      biddingHoursOnboarded += v.bidding;
      inviteHoursOnboarded += v.invites;
    }
    const totalHoursOnboarded = biddingHoursOnboarded + inviteHoursOnboarded;

    return {
      range: { from: range.from, to: range.to },
      projectManagerId: projectManagerId ?? null,
      requestedHours,
      biddingHoursOnboarded,
      inviteHoursOnboarded,
      totalHoursOnboarded,
      remainingHours: Math.max(0, requestedHours - totalHoursOnboarded),
    };
  }

  /** Per-profile Request vs Achievement table, plus totals (Part: spec
   *  section 9). Scoped the same way getWeeklyTarget is: a Project Manager
   *  always sees only their own; a reviewer/admin can pass projectManagerId
   *  to inspect one person or omit it for an org-wide, all-PMs view. */
  async getAchievement(orgId: string, requesterId: string, requesterRole: Role, query: QueryUpworkWeekDto) {
    const range = this.resolveRange(query);
    const projectManagerId = requesterRole === Role.PROJECT_MANAGER ? requesterId : query.projectManagerId;

    const items = await this.prisma.upworkRequestItem.findMany({
      where: {
        request: {
          orgId,
          status: UpworkRequestStatus.APPROVED,
          requestDate: { gte: range.from, lte: range.to },
          ...(projectManagerId ? { projectManagerId } : {}),
        },
        ...(query.profileName ? { profileName: { equals: query.profileName, mode: "insensitive" } } : {}),
      },
      select: { profileName: true, requestedHours: true },
    });

    const requestedByProfile = new Map<string, { profileName: string; requested: number }>();
    for (const item of items) {
      const key = item.profileName.toLowerCase();
      const entry = requestedByProfile.get(key) ?? { profileName: item.profileName, requested: 0 };
      entry.requested += item.requestedHours;
      requestedByProfile.set(key, entry);
    }

    const achievedByProfile = await this.sumOnboardedHoursByProfile(orgId, range, [...requestedByProfile.keys()]);

    const rows = [...requestedByProfile.entries()]
      .map(([key, { profileName, requested }]) => {
        const achieved = achievedByProfile.get(key) ?? { bidding: 0, invites: 0 };
        const totalAchieved = achieved.bidding + achieved.invites;
        return {
          profileName,
          requested,
          bidding: achieved.bidding,
          invites: achieved.invites,
          totalAchieved,
          remaining: Math.max(0, requested - totalAchieved),
        };
      })
      .sort((a, b) => a.profileName.localeCompare(b.profileName));

    const totals = rows.reduce(
      (acc, r) => ({
        requested: acc.requested + r.requested,
        bidding: acc.bidding + r.bidding,
        invites: acc.invites + r.invites,
        totalAchieved: acc.totalAchieved + r.totalAchieved,
        remaining: acc.remaining + r.remaining,
      }),
      { requested: 0, bidding: 0, invites: 0, totalAchieved: 0, remaining: 0 },
    );

    return { range: { from: range.from, to: range.to }, rows, totals };
  }

  /**
   * Org-wide card deck for the Upwork Dashboard's Requests section (Part:
   * spec section 10). `biddingHours`/`inviteHours`/`totalOnboardedHours`
   * here are NOT scoped to only the profiles that were requested — unlike
   * getWeeklyTarget/getAchievement above, this is meant to show everything
   * the org onboarded in the period regardless of whether a request happened
   * to cover it, so these three numbers can legitimately exceed
   * `requestedHours`.
   */
  async getDashboardSummary(orgId: string, query: QueryUpworkWeekDto) {
    const range = this.resolveRange(query);

    const [approvedAgg, pendingReview, approvedCount, rejectedCount, approvedItems] = await Promise.all([
      this.prisma.upworkRequest.aggregate({
        where: { orgId, status: UpworkRequestStatus.APPROVED, requestDate: { gte: range.from, lte: range.to } },
        _sum: { totalRequestedHours: true },
      }),
      this.prisma.upworkRequest.count({
        where: { orgId, status: { in: [UpworkRequestStatus.SUBMITTED, UpworkRequestStatus.UNDER_REVIEW] }, requestDate: { gte: range.from, lte: range.to } },
      }),
      this.prisma.upworkRequest.count({ where: { orgId, status: UpworkRequestStatus.APPROVED, requestDate: { gte: range.from, lte: range.to } } }),
      this.prisma.upworkRequest.count({ where: { orgId, status: UpworkRequestStatus.REJECTED, requestDate: { gte: range.from, lte: range.to } } }),
      this.prisma.upworkRequestItem.findMany({
        where: { request: { orgId, status: UpworkRequestStatus.APPROVED, requestDate: { gte: range.from, lte: range.to } } },
        include: { request: { select: { projectManagerId: true, projectManager: { select: { name: true } } } } },
      }),
    ]);

    const requestedHours = approvedAgg._sum.totalRequestedHours ?? 0;

    const orgWideByProfile = await this.sumOnboardedHoursByProfile(orgId, range); // unscoped -- every profile
    let biddingHours = 0;
    let inviteHours = 0;
    for (const v of orgWideByProfile.values()) {
      biddingHours += v.bidding;
      inviteHours += v.invites;
    }
    const totalOnboardedHours = biddingHours + inviteHours;

    const byPM = new Map<string, { projectManagerId: string; name: string; requestedHours: number }>();
    const byProfile = new Map<string, { profileName: string; requestedHours: number }>();
    for (const item of approvedItems) {
      const pmEntry = byPM.get(item.request.projectManagerId) ?? {
        projectManagerId: item.request.projectManagerId,
        name: item.request.projectManager.name,
        requestedHours: 0,
      };
      pmEntry.requestedHours += item.requestedHours;
      byPM.set(item.request.projectManagerId, pmEntry);

      const key = item.profileName.toLowerCase();
      const profEntry = byProfile.get(key) ?? { profileName: item.profileName, requestedHours: 0 };
      profEntry.requestedHours += item.requestedHours;
      byProfile.set(key, profEntry);
    }

    const achievedByRequestedProfile = await this.sumOnboardedHoursByProfile(orgId, range, [...byProfile.keys()]);

    return {
      range: { from: range.from, to: range.to },
      requestedHours,
      biddingHours,
      inviteHours,
      totalOnboardedHours,
      remainingHours: Math.max(0, requestedHours - totalOnboardedHours),
      pendingReview,
      approvedCount,
      rejectedCount,
      byProjectManager: [...byPM.values()].sort((a, b) => b.requestedHours - a.requestedHours),
      byProfile: [...byProfile.entries()]
        .map(([key, v]) => {
          const achieved = achievedByRequestedProfile.get(key) ?? { bidding: 0, invites: 0 };
          return { ...v, achievedHours: achieved.bidding + achieved.invites };
        })
        .sort((a, b) => b.requestedHours - a.requestedHours),
    };
  }
}
