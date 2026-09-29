import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { AgentOptimizationService } from "./agent-optimization.service";

/** ADMIN-only throughout — this reads/writes the same agent prompts Settings'
 *  Agent Prompts page gates to ADMIN, and "Run now" costs a Claude CLI call
 *  same as the manual Analytics AI-insights button. */
@Controller("agent-optimization")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AgentOptimizationController {
  constructor(private readonly service: AgentOptimizationService) {}

  @Get("cycles")
  listCycles(@CurrentUser() user: JwtClaims) {
    return this.service.listCycles(user.orgId);
  }

  @Post("run-now")
  runNow(@CurrentUser() user: JwtClaims) {
    return this.service.runCycle(user.orgId);
  }

  @Post("cycles/:id/revert")
  revert(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.revertCycle(user.orgId, id);
  }
}
