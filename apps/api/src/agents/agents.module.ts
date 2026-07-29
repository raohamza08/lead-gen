import { Module } from "@nestjs/common";
import { AgentRunsController } from "./agent-runs.controller";

@Module({ controllers: [AgentRunsController] })
export class AgentsModule {}
