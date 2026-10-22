import { Module } from "@nestjs/common";
import { UpworkGraphQLClient } from "./upwork-graphql.client";

/**
 * Cross-domain infrastructure every Upwork API sub-module depends on (Part:
 * Upwork API integration — modular architecture pass, 2026-10-22).
 * `UpworkGraphQLClient` is the one piece every domain (connection, Connects
 * usage, proposals, and every future domain) needs — a single shared
 * instance via DI, not re-instantiated per module.
 */
@Module({
  providers: [UpworkGraphQLClient],
  exports: [UpworkGraphQLClient],
})
export class UpworkSharedModule {}
