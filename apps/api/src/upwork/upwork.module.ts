import { Module } from "@nestjs/common";
import { UpworkController } from "./upwork.controller";
import { UpworkService } from "./upwork.service";

@Module({
  controllers: [UpworkController],
  providers: [UpworkService],
})
export class UpworkModule {}
