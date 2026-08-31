import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { InternalAuthGuard } from "../common/guards/internal-auth.guard";
import { AgentExecutionService } from "./agent-execution.service";
import { StartAgentExecutionDto, SucceedAgentExecutionDto, FailAgentExecutionDto } from "./dto/agent-execution.dto";

/**
 * Called by the ai-workers process at the start/end of every agent run that
 * gates a lead's next stage (Part: reliability overhaul, 2026-08-31) — see
 * AgentExecutionService's docblock. Internal-token-guarded, same as
 * AgentRunsController and LeadsController's draft-email endpoints.
 */
@Controller("agent-executions")
@UseGuards(InternalAuthGuard)
export class AgentExecutionController {
  constructor(private readonly executions: AgentExecutionService) {}

  @Post("start")
  start(@Body() dto: StartAgentExecutionDto) {
    return this.executions.start(dto);
  }

  @Post("succeed")
  succeed(@Body() dto: SucceedAgentExecutionDto) {
    return this.executions.succeed(dto.orgId, dto.leadId, dto.agent, dto.executionId);
  }

  @Post("fail")
  fail(@Body() dto: FailAgentExecutionDto) {
    return this.executions.fail(dto.orgId, {
      leadId: dto.leadId,
      agent: dto.agent,
      executionId: dto.executionId,
      errorDetail: dto.errorDetail,
      retryable: dto.retryable,
      skipNotification: dto.skipNotification,
    });
  }
}
