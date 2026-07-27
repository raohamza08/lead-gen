import { Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { PrismaService } from "../common/prisma/prisma.service";
import { UpsertNicheFilterDto } from "./dto/upsert-niche-filter.dto";

/**
 * Part E6 scheduler supervisor: one dynamic CronJob per active NicheFilter,
 * keyed by filter id, driven by that filter's own scheduleCron/timezone
 * columns. This is what turns "100+ verified leads/day" from a manual
 * "Run now" click into something that actually happens on its own.
 */
function jobName(filterId: string): string {
  return `niche-filter:${filterId}`;
}

@Injectable()
export class NicheFiltersService implements OnModuleInit {
  private readonly logger = new Logger(NicheFiltersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  /** Registers a cron job for every active filter that already exists at boot. */
  async onModuleInit() {
    const activeFilters = await this.prisma.nicheFilter.findMany({ where: { active: true } });
    for (const filter of activeFilters) {
      this.registerJob(filter);
    }
    this.logger.log(`Scheduled ${activeFilters.length} active niche filter(s) on startup`);
  }

  findAllForOrg(orgId: string) {
    return this.prisma.nicheFilter.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } });
  }

  async findOne(orgId: string, id: string) {
    const filter = await this.prisma.nicheFilter.findFirst({ where: { id, orgId } });
    if (!filter) throw new NotFoundException("Niche filter not found");
    return filter;
  }

  async create(orgId: string, dto: UpsertNicheFilterDto) {
    const filter = await this.prisma.nicheFilter.create({ data: { orgId, ...dto } });
    if (filter.active) this.registerJob(filter);
    return filter;
  }

  async update(orgId: string, id: string, dto: UpsertNicheFilterDto) {
    await this.findOne(orgId, id);
    // Edits take effect on the NEXT scheduled run only (Part F4) — the scheduler
    // always re-reads the current row when it fires, so no separate "apply"
    // step is needed. But the schedule/timezone/active-ness itself may have
    // changed, so the registered job needs to be replaced, not just left as-is.
    const updated = await this.prisma.nicheFilter.update({ where: { id }, data: dto });
    this.unregisterJob(updated.id);
    if (updated.active) this.registerJob(updated);
    return updated;
  }

  /** Creates (or replaces) the dynamic CronJob backing one niche filter. */
  private registerJob(filter: { id: string; orgId: string; scheduleCron: string; timezone: string }) {
    this.unregisterJob(filter.id);
    let job: CronJob;
    try {
      job = new CronJob(
        filter.scheduleCron,
        () => {
          this.runNow(filter.orgId, filter.id).catch((err) =>
            this.logger.error(`Scheduled run for niche filter ${filter.id} failed: ${(err as Error).message}`),
          );
        },
        null,
        true,
        filter.timezone,
      );
    } catch (err) {
      this.logger.error(
        `Invalid scheduleCron/timezone for niche filter ${filter.id} (${filter.scheduleCron} / ${filter.timezone}): ${(err as Error).message}`,
      );
      return;
    }
    this.schedulerRegistry.addCronJob(jobName(filter.id), job);
  }

  private unregisterJob(filterId: string) {
    const name = jobName(filterId);
    if (this.schedulerRegistry.doesExist("cron", name)) {
      this.schedulerRegistry.deleteCronJob(name);
    }
  }

  /**
   * Manual trigger (Part E2: POST /niche-filters/:id/run-now). Opens an
   * ExtractionRun record and hands off to the Claude lead-gen agent service.
   * The agent call is fire-and-forget from the API's perspective — progress is
   * reported back via the agent calling POST /leads as it verifies each lead
   * and PATCH /extraction-runs/:id when it finishes (Part C1 sequence).
   */
  async runNow(orgId: string, id: string) {
    const filter = await this.findOne(orgId, id);
    const run = await this.prisma.extractionRun.create({
      data: { filterId: filter.id, status: "RUNNING" },
    });

    const aiWorkersUrl = this.config.get<string>("AI_WORKERS_URL", "http://localhost:8000");
    try {
      await fetch(`${aiWorkersUrl}/lead-gen/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id, filter }),
      });
    } catch (err) {
      this.logger.warn(`Failed to dispatch extraction run ${run.id} to AI workers: ${(err as Error).message}`);
      // Non-fatal: the run row stays RUNNING; a reconciliation job (Part E6/E7)
      // should flag runs stuck in RUNNING past a timeout as FAILED.
    }
    return run;
  }
}
