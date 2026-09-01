import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserAccessDto } from "./dto/update-user-access.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { PrimaryAdminGuard } from "../common/guards/primary-admin.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { RequiresPrimaryAdmin } from "../common/decorators/requires-primary-admin.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB — a profile picture, not a media library upload

@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  findAll(@CurrentUser() user: JwtClaims) {
    return this.usersService.findAllForOrg(user.orgId);
  }

  /** No @Roles() — every authenticated user, any role, reads their own module flags (e.g. for the sidebar). */
  @Get("me")
  me(@CurrentUser() user: JwtClaims) {
    return this.usersService.getSelf(user.orgId, user.sub);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@CurrentUser() user: JwtClaims, @Body() dto: CreateUserDto) {
    return this.usersService.create(user.orgId, user.sub, dto);
  }

  @Patch(":id/deactivate")
  @Roles(Role.ADMIN)
  deactivate(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.usersService.setActive(user.orgId, user.sub, id, false);
  }

  @Patch(":id/activate")
  @Roles(Role.ADMIN)
  activate(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.usersService.setActive(user.orgId, user.sub, id, true);
  }

  @Patch(":id/role/:role")
  @Roles(Role.ADMIN)
  changeRole(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Param("role") role: Role) {
    // An admin demoting themselves could lock the org out of admin access
    // entirely if they're the only one — changing your own role always goes
    // through another admin instead.
    if (id === user.sub) {
      throw new ForbiddenException("You can't change your own role — ask another admin.");
    }
    return this.usersService.setRole(user.orgId, user.sub, id, role);
  }

  @Get(":id/access")
  @Roles(Role.ADMIN)
  getAccess(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.usersService.getAccess(user.orgId, id);
  }

  @Patch(":id/access")
  @Roles(Role.ADMIN)
  updateAccess(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpdateUserAccessDto) {
    return this.usersService.updateAccess(user.orgId, user.sub, id, dto);
  }

  /** Only the current primary admin can hand the flag off — see
   *  UsersService.transferPrimaryAdmin's docblock for why this is always a
   *  deliberate, auditable transfer rather than a self-service promotion. */
  @Patch(":id/primary-admin")
  @UseGuards(PrimaryAdminGuard)
  @RequiresPrimaryAdmin()
  transferPrimaryAdmin(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.usersService.transferPrimaryAdmin(user.orgId, user.sub, id);
  }

  // ---- My Profile (Part: User Profile, 2026-08-31) — every authenticated
  // user manages their own, no @Roles() needed since it's always "me". ----

  @Patch("me/profile")
  updateProfile(@CurrentUser() user: JwtClaims, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.sub, dto);
  }

  @Post("me/password")
  async changePassword(@CurrentUser() user: JwtClaims, @Body() dto: ChangePasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException("New password and confirmation do not match");
    }
    return this.usersService.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }

  @Post("me/avatar")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_AVATAR_BYTES } }))
  uploadAvatar(@CurrentUser() user: JwtClaims, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException("No file uploaded");
    if (!file.mimetype.startsWith("image/")) {
      throw new BadRequestException("Only image files are supported for a profile picture");
    }
    return this.usersService.uploadAvatar(user.sub, file);
  }

  @Delete("me/avatar")
  removeAvatar(@CurrentUser() user: JwtClaims) {
    return this.usersService.removeAvatar(user.sub);
  }

  // GET :id/avatar lives in AvatarFileController instead — a plain <img src>
  // tag can't attach the Bearer token this controller's class-level
  // JwtAuthGuard requires, so it needs to be unguarded (see that file).
}
