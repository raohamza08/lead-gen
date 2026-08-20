import { Module } from "@nestjs/common";
import { OrganizationService } from "./organization.service";
import { OrganizationController } from "./organization.controller";
import { PromptOverridesInternalController } from "./prompt-overrides-internal.controller";

@Module({
  controllers: [OrganizationController, PromptOverridesInternalController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
