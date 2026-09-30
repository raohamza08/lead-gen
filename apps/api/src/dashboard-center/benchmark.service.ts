import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";

@Injectable()
export class BenchmarkService {
  constructor(private readonly prisma: PrismaService) {}

  async list(orgId: string) {
    return this.prisma.benchmark.findMany({ where: { orgId }, orderBy: { metricKey: "asc" } });
  }

  /** Upsert by (orgId, metricKey) — setting a benchmark for a metric that
   *  already has one replaces it rather than creating a second, since only
   *  one target per metric per org makes sense. */
  async set(orgId: string, userId: string, metricKey: string, targetValue: number) {
    return this.prisma.benchmark.upsert({
      where: { orgId_metricKey: { orgId, metricKey } },
      create: { orgId, metricKey, targetValue, updatedByUserId: userId },
      update: { targetValue, updatedByUserId: userId },
    });
  }

  async remove(orgId: string, metricKey: string) {
    await this.prisma.benchmark.deleteMany({ where: { orgId, metricKey } });
    return { removed: true };
  }

  /** Actual vs. target vs. difference — never a bare "good/bad" (Part: spec
   *  section 15). Callers pass in the real, already-computed actual values
   *  keyed the same way benchmarks are; this only handles the lookup/diff. */
  async compare(orgId: string, actuals: Record<string, number>) {
    const benchmarks = await this.list(orgId);
    return benchmarks.map((b) => ({
      metricKey: b.metricKey,
      target: b.targetValue,
      actual: actuals[b.metricKey],
      difference: actuals[b.metricKey] !== undefined ? actuals[b.metricKey] - b.targetValue : undefined,
    }));
  }
}
