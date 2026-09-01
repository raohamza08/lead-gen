import { Global, Module } from "@nestjs/common";
import { UserAccessCacheService } from "./user-access-cache.service";

/** Global (like CacheModule/PrismaModule) — guards in common/guards and
 *  NotificationsService both need this without every module importing it. */
@Global()
@Module({
  providers: [UserAccessCacheService],
  exports: [UserAccessCacheService],
})
export class UserAccessCacheModule {}
