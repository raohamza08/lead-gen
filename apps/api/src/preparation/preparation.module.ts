import { Global, Module } from "@nestjs/common";
import { PreparationPipelineService } from "./preparation-pipeline.service";

/** Global (like AgentDispatchModule/SendingModule) so AgentExecutionService
 *  and LeadsService can both call evaluate() without a module-import cycle
 *  between agents/, leads/, and sequencer/. */
@Global()
@Module({
  providers: [PreparationPipelineService],
  exports: [PreparationPipelineService],
})
export class PreparationModule {}
