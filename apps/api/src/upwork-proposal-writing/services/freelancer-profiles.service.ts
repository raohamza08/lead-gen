import { Injectable, NotFoundException } from "@nestjs/common";
import { UpworkProfileGroup } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";

@Injectable()
export class FreelancerProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string) {
    return this.prisma.upworkFreelancerProfile.findMany({
      where: { orgId },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Only active profiles — what the generator actually feeds to Gemini for
   *  the best-fit suggestion. Inactive ones stay listed in Settings (so
   *  they're not lost) but are excluded here so a profile someone's not
   *  bidding under anymore never gets suggested. */
  async listActive(orgId: string) {
    return this.prisma.upworkFreelancerProfile.findMany({
      where: { orgId, active: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async create(orgId: string, input: { name: string; niche: string; group?: UpworkProfileGroup }) {
    return this.prisma.upworkFreelancerProfile.create({
      data: { orgId, name: input.name, niche: input.niche, group: input.group },
    });
  }

  async update(orgId: string, id: string, input: { name?: string; niche?: string; active?: boolean; group?: UpworkProfileGroup | null }) {
    const result = await this.prisma.upworkFreelancerProfile.updateMany({
      where: { id, orgId },
      data: input,
    });
    if (result.count === 0) throw new NotFoundException("Freelancer profile not found");
    return this.prisma.upworkFreelancerProfile.findUniqueOrThrow({ where: { id } });
  }

  async delete(orgId: string, id: string) {
    const result = await this.prisma.upworkFreelancerProfile.deleteMany({ where: { id, orgId } });
    if (result.count === 0) throw new NotFoundException("Freelancer profile not found");
    return { deleted: true };
  }
}
