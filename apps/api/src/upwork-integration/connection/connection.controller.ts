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
 * ModuleAccessGuard + `@RequiresModule([...every UPWORK_AGENCY_* flag])` at
 * class level (Part: per-module access, 2026-10-23 — narrowed from the
 * single `"UPWORK_API"` flag so this stays reachable for a person granted
 * just one specific Agency page); every
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
// OR across every Upwork Agency page flag (Part: per-module access,
// 2026-10-23) — `status`/`callback-url` are called by EVERY one of the 12
// domain pages before they render, so a person granted only e.g. Rooms
// must still be able to reach them; narrowing this to one specific flag
// would 403 that check for anyone who doesn't also have that flag.
@RequiresModule([
  "UPWORK_AGENCY_OVERVIEW",
  "UPWORK_AGENCY_ORGANIZATION",
  "UPWORK_AGENCY_TRANSACTIONS",
  "UPWORK_AGENCY_BIDDING",
  "UPWORK_AGENCY_INVITES",
  "UPWORK_AGENCY_CONTRACT_PROPOSALS",
  "UPWORK_AGENCY_SUBMIT_PROPOSAL",
  "UPWORK_AGENCY_WORK_HISTORY",
  "UPWORK_AGENCY_FREELANCERS",
  "UPWORK_AGENCY_ROOMS",
  "UPWORK_AGENCY_JOBS",
  "UPWORK_AGENCY_ONTOLOGY",
  "UPWORK_AGENCY_CONNECTION",
])
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
