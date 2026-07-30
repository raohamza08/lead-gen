import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";

@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  findAll(@CurrentUser() user: JwtClaims) {
    return this.usersService.findAllForOrg(user.orgId);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@CurrentUser() user: JwtClaims, @Body() dto: CreateUserDto) {
    return this.usersService.create(user.orgId, dto);
  }

  @Patch(":id/deactivate")
  @Roles(Role.ADMIN)
  deactivate(@Param("id") id: string) {
    return this.usersService.setActive(id, false);
  }

  @Patch(":id/activate")
  @Roles(Role.ADMIN)
  activate(@Param("id") id: string) {
    return this.usersService.setActive(id, true);
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
    return this.usersService.setRole(id, role);
  }
}
