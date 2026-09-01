import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./users.controller";
import { AvatarFileController } from "./avatar-file.controller";
import { EmailModule } from "../email/email.module";
import { OrganizationModule } from "../organization/organization.module";
import { LocalDiskMediaStorageService } from "../social-media/media/local-disk-media-storage.service";

@Module({
  imports: [EmailModule, OrganizationModule],
  // Reuses Social Media's storage abstraction for avatar bytes (Part: User
  // Profile, 2026-08-31) rather than a second disk-storage implementation —
  // each module gets its own instance (both stateless besides reading
  // MEDIA_STORAGE_DIR from config), so no cross-module coupling beyond the
  // shared class.
  providers: [UsersService, LocalDiskMediaStorageService],
  controllers: [UsersController, AvatarFileController],
  exports: [UsersService],
})
export class UsersModule {}
