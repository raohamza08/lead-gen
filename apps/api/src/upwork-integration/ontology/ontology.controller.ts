import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { ModuleAccessGuard } from "../../common/guards/module-access.guard";
import { RequiresModule } from "../../common/decorators/requires-module.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";
import { UpworkOntologyService } from "./ontology.service";

/** Ontology & Reference Data domain (spec Module F) — LIVE. Same guard
 *  stack and `upwork-api` route prefix as every other Upwork
 *  sub-controller. */
@Controller("upwork-api")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleAccessGuard)
@RequiresModule("UPWORK_API")
export class UpworkOntologyController {
  constructor(private readonly ontology: UpworkOntologyService) {}

  @Get("ontology")
  getAll(@CurrentUser() user: JwtClaims) {
    return this.ontology.getAll(user.orgId);
  }
}
