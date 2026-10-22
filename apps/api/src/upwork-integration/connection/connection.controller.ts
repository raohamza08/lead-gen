import { Body, Controller, Delete, Get, Put, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims, Role } from "@leadgen/types";
import { UpworkApiConnectionService } from "./upwork-api-connection.service";
import { SetOrganizationIdDto } from "./set-organization-id.dto";

/**
 * Connection lifecycle (callback URL, connect, status, disconnect, manual
 * organization-ID override) — the shared core every other Upwork domain
 * module depends on (Part: Upwork API integration — modular architecture
 * pass, 2026-10-22, split out of the original single UpworkApiController).
 * Same guard stack as every other Upwork sub-controller, kept consistent on
 * purpose: `@Controller("upwork-api")` + JwtAuthGuard/RolesGuard/
 * ModuleAccessGuard + `@RequiresModule("UPWORK_API")` at class level; every
 * route here shares the exact same route prefix as the other domain
 * controllers (NestJS allows multiple controllers registered under the same
 * path prefix, as long as their own sub-paths don't collide) so the public
 * REST surface (`/api/v1/upwork-api/...`) is unchanged by this refactor.
 *
 * connect/disconnect/organization-id stay ADMIN-only on top of the module
 * flag — these change which org every other domain's sync/read pulls data
 * from, a privileged, org-wide action, not a per-user preference.
 */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkConnectionController {
  constructor(private readonly connection: UpworkApiConnectionService) {}

  @Get("callback-url")
  getCallbackUrl() {
    return this.connection.getCallbackUrl();
  }

  @Get("connect")
  @Roles(Role.ADMIN)
  connect(@CurrentUser() user: JwtClaims) {
    return this.connection.initiateConnect(user);
  }

  @Get("status")
  getStatus(@CurrentUser() user: JwtClaims) {
    return this.connection.getStatus(user.orgId);
  }

  @Delete("connection")
  @Roles(Role.ADMIN)
  disconnect(@CurrentUser() user: JwtClaims) {
    return this.connection.disconnect(user);
  }

  @Put("organization-id")
  @Roles(Role.ADMIN)
  setOrganizationId(@CurrentUser() user: JwtClaims, @Body() dto: SetOrganizationIdDto) {
    return this.connection.setOrganizationId(user, dto.organizationId);
  }
}
