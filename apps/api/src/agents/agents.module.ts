import { Module } from "@nestjs/common";
import { AgentRunsController } from "./agent-runs.controller";
import { AgentsController } from "./agents.controller";

@Module({ controllers: [AgentRunsController, AgentsController] })
export class AgentsModule {}
