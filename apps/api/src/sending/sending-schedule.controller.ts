import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { SendingSchedulerService } from "./sending-scheduler.service";
import { SendingQueueService } from "./sending-queue.service";
import { UpsertSendingScheduleDto } from "./dto/upsert-sending-schedule.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { ModuleAccessGuard } from "../common/guards/module-access.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequiresModule } from "../common/decorators/requires-module.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";

/** Settings > Lead Generation's scheduler section (Part: Preparation
 *  Pipeline / Sending Queue, 2026-09-01) — one schedule per org, off by
 *  default (no schedule required per requirement #4). */
@Controller("sending-schedule")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("LEAD_GENERATION")
export class SendingScheduleController {
  constructor(
    private readonly scheduler: SendingSchedulerService,
    private readonly sendingQueue: SendingQueueService,
  ) {}

  @Get()
  async get(@CurrentUser() user: JwtClaims) {
    const schedule = await this.scheduler.getForOrg(user.orgId);
    return { schedule, nextFireAt: schedule ? this.scheduler.getNextFireDate(schedule) : null };
  }

  @Get("dashboard")
  getDashboard(@CurrentUser() user: JwtClaims) {
    return this.sendingQueue.getDashboard(user.orgId);
  }

  @Put()
  @Roles(Role.ADMIN, Role.MANAGER)
  async upsert(@CurrentUser() user: JwtClaims, @Body() dto: UpsertSendingScheduleDto) {
    const schedule = await this.scheduler.upsert(user.orgId, dto);
    return { schedule, nextFireAt: this.scheduler.getNextFireDate(schedule) };
  }
}
