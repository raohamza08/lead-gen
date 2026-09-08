import { Module } from "@nestjs/common";
import { AgentRunsController } from "./agent-runs.controller";
import { AgentsController } from "./agents.controller";
import { AgentExecutionController } from "./agent-execution.controller";
import { AgentExecutionService } from "./agent-execution.service";
import { AgentExecutionSweepQueue } from "./agent-execution-sweep.queue";
import { AgentExecutionSweepWorker } from "./agent-execution-sweep.worker";
import { AiWorkersHealthQueue } from "./ai-workers-health.queue";
import { AiWorkersHealthWorker } from "./ai-workers-health.worker";
import { SequencerModule } from "../sequencer/sequencer.module";

@Module({
  imports: [SequencerModule],
  controllers: [AgentRunsController, AgentsController, AgentExecutionController],
  providers: [
    AgentExecutionService,
    AgentExecutionSweepQueue,
    AgentExecutionSweepWorker,
    AiWorkersHealthQueue,
    AiWorkersHealthWorker,
  ],
})
export class AgentsModule {}
