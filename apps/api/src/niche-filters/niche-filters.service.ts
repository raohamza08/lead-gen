import { Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { PrismaService } from "../common/prisma/prisma.service";
import { UpsertNicheFilterDto } from "./dto/upsert-niche-filter.dto";
import { buildSearchBrief } from "./search-brief";
import { AgentDispatchQueue } from "../common/queue/agent-dispatch.queue";

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
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly agentDispatch: AgentDispatchQueue,
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

  /**
   * Deletes a niche filter, keeping the leads it produced.
   *
   * Leads are detached (filterId set to null) rather than deleted. They are
   * real companies that were verified and may already be mid-sequence —
   * removing a targeting rule must never destroy the pipeline it built.
   *
   * Extraction runs ARE deleted: they are operational logs of this filter's
   * activity and are meaningless without it. That does shift the historical
   * duplicate-rate figure, which aggregates over runs, so the affected counts
   * are returned for the caller to show before confirming.
   *
   * The cron job is unregistered first. Doing it after the delete would leave a
   * window where a scheduled run fires against a filter that no longer exists.
   */
  async remove(orgId: string, id: string) {
    const filter = await this.prisma.nicheFilter.findFirst({ where: { id, orgId } });
    if (!filter) throw new NotFoundException(`Niche filter ${id} not found`);

    this.unregisterJob(id);

    const [leads, runs] = await Promise.all([
      this.prisma.lead.count({ where: { filterId: id } }),
      this.prisma.extractionRun.count({ where: { filterId: id } }),
    ]);

    await this.prisma.$transaction([
      this.prisma.lead.updateMany({ where: { filterId: id }, data: { filterId: null } }),
      this.prisma.campaign.updateMany({ where: { filterId: id }, data: { filterId: null } }),
      this.prisma.extractionRun.deleteMany({ where: { filterId: id } }),
      this.prisma.nicheFilter.delete({ where: { id } }),
    ]);

    this.logger.log(`Deleted niche filter ${id}: kept ${leads} lead(s), removed ${runs} run(s)`);
    return { deleted: true, leadsKept: leads, runsDeleted: runs };
  }

  /** Counts of what a delete would affect, so the UI can warn before doing it. */
  async deletionImpact(orgId: string, id: string) {
    const filter = await this.prisma.nicheFilter.findFirst({ where: { id, orgId } });
    if (!filter) throw new NotFoundException(`Niche filter ${id} not found`);

    const [leads, runs] = await Promise.all([
      this.prisma.lead.count({ where: { filterId: id } }),
      this.prisma.extractionRun.count({ where: { filterId: id } }),
    ]);
    return { leadsKept: leads, runsDeleted: runs };
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

    // searchBrief expands the stored taxonomy values into explained criteria.
    // Without it the worker only has raw enum tokens like MANUAL_WORKFLOWS,
    // which the model can't act on. `filter` is still sent so the worker
    // keeps the structured values it needs (orgId, dailyTarget, id).
    await this.agentDispatch.add({
      kind: "extraction_run",
      runId: run.id,
      orgId,
      filter,
      searchBrief: buildSearchBrief(filter),
    });
    // The queue retries transient dispatch failures on its own (Part:
    // autonomous system) and notifies if they're exhausted — a run stuck in
    // RUNNING past that point is a genuine failure, not something this call
    // needs to guess at with its own try/catch.
    return run;
  }
}
