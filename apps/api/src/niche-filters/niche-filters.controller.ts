import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { NicheFiltersService } from "./niche-filters.service";
import { UpsertNicheFilterDto } from "./dto/upsert-niche-filter.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";

@Controller("niche-filters")
@UseGuards(JwtAuthGuard, RolesGuard)
export class NicheFiltersController {
  constructor(private readonly service: NicheFiltersService) {}

  @Get()
  findAll(@CurrentUser() user: JwtClaims) {
    return this.service.findAllForOrg(user.orgId);
  }

  @Get(":id")
  findOne(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.findOne(user.orgId, id);
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  create(@CurrentUser() user: JwtClaims, @Body() dto: UpsertNicheFilterDto) {
    return this.service.create(user.orgId, dto);
  }

  @Patch(":id")
  @Roles(Role.ADMIN, Role.MANAGER)
  update(@CurrentUser() user: JwtClaims, @Param("id") id: string, @Body() dto: UpsertNicheFilterDto) {
    return this.service.update(user.orgId, id, dto);
  }

  @Post(":id/run-now")
  @Roles(Role.ADMIN, Role.MANAGER)
  runNow(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.runNow(user.orgId, id);
  }

  /** What a delete would affect, so the UI can warn with real numbers first. */
  @Get(":id/deletion-impact")
  @Roles(Role.ADMIN, Role.MANAGER)
  deletionImpact(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.deletionImpact(user.orgId, id);
  }

  // ADMIN only. Deleting a filter removes its extraction history, which shifts
  // reported duplicate rates — a heavier action than editing one.
  @Delete(":id")
  @Roles(Role.ADMIN)
  remove(@CurrentUser() user: JwtClaims, @Param("id") id: string) {
    return this.service.remove(user.orgId, id);
  }
}
