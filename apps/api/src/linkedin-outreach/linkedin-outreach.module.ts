import { Module } from "@nestjs/common";
import { LinkedinOutreachController } from "./linkedin-outreach.controller";
import { LinkedinOutreachSessionService } from "./services/linkedin-outreach-session.service";

@Module({
  controllers: [LinkedinOutreachController],
  providers: [LinkedinOutreachSessionService],
  // RealtimeGateway's socket handler delegates input events straight to the
  // session service (see that gateway's `linkedinSession.input` handler).
  exports: [LinkedinOutreachSessionService],
})
export class LinkedinOutreachModule {}
