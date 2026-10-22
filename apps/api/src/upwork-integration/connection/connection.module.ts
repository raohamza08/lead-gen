import { Module } from "@nestjs/common";
import { UpworkSharedModule } from "../shared/upwork-shared.module";
import { UpworkConnectionController } from "./connection.controller";
import { UpworkOAuthCallbackController } from "./upwork-oauth-callback.controller";
import { UpworkApiConnectionService } from "./upwork-api-connection.service";
import { UpworkOAuthClient } from "./upwork-oauth.client";
import { UpworkOAuthStateStore } from "./upwork-oauth-state.store";

/**
 * Core OAuth connection lifecycle (Part: Upwork API integration — modular
 * architecture pass, 2026-10-22). Every other Upwork domain module imports
 * this one for `UpworkApiConnectionService` (token refresh/decrypt), not
 * the other way around — this module has no dependency on any domain
 * module, keeping it the stable base every domain builds on.
 */
@Module({
  imports: [UpworkSharedModule],
  controllers: [UpworkConnectionController, UpworkOAuthCallbackController],
  providers: [UpworkApiConnectionService, UpworkOAuthClient, UpworkOAuthStateStore],
  exports: [UpworkApiConnectionService],
})
export class UpworkConnectionModule {}
