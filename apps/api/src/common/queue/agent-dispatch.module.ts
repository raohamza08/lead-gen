import { Global, Module } from "@nestjs/common";
import { NotificationsModule } from "../../notifications/notifications.module";
import { AgentDispatchQueue } from "./agent-dispatch.queue";
import { AgentDispatchWorker } from "./agent-dispatch.worker";
import { ImportEnrichmentQueue } from "./import-enrichment.queue";
import { ImportEnrichmentWorker } from "./import-enrichment.worker";

/** Global (like PrismaModule/RealtimeModule) so LeadsService, SequencerService
 *  and NicheFiltersService can all enqueue without each importing this module. */
@Global()
@Module({
  imports: [NotificationsModule],
  providers: [AgentDispatchQueue, AgentDispatchWorker, ImportEnrichmentQueue, ImportEnrichmentWorker],
  exports: [AgentDispatchQueue, ImportEnrichmentQueue],
})
export class AgentDispatchModule {}
