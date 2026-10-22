import { Module } from "@nestjs/common";
import { UpworkConnectionModule } from "../connection/connection.module";
import { UpworkSnapshotsController } from "./snapshots.controller";
import { UpworkSnapshotsService } from "./snapshots.service";

/** Snapshots domain (spec Module D) — currently BLOCKED and a semantic
 *  mismatch (Part: Upwork API integration — Snapshots domain,
 *  2026-10-23), see snapshots.service.ts's own docblock. */
@Module({
  imports: [UpworkConnectionModule],
  controllers: [UpworkSnapshotsController],
  providers: [UpworkSnapshotsService],
})
export class UpworkSnapshotsModule {}
