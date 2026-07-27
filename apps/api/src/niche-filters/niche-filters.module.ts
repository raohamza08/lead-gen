import { Module } from "@nestjs/common";
import { NicheFiltersService } from "./niche-filters.service";
import { NicheFiltersController } from "./niche-filters.controller";
import { ExtractionRunsController } from "./extraction-runs.controller";

@Module({
  providers: [NicheFiltersService],
  controllers: [NicheFiltersController, ExtractionRunsController],
  exports: [NicheFiltersService],
})
export class NicheFiltersModule {}
