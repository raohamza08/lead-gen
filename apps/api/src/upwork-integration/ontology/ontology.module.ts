import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkOntologyController } from "./ontology.controller";
import { UpworkOntologyService } from "./ontology.service";

/** Ontology & Reference Data domain (spec Module F) — LIVE (Part: Upwork
 *  API integration — Ontology domain, 2026-10-23). Self-contained, same
 *  shape as every other live domain module. */
@Module({
  imports: [UpworkSharedModule, UpworkConnectionModule],
  controllers: [UpworkOntologyController],
  providers: [UpworkOntologyService],
})
export class UpworkOntologyModule {}
