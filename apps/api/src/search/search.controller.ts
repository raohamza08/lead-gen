import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtClaims } from "@leadgen/types";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { SearchService } from "./search.service";

@Controller("search")
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  globalSearch(@CurrentUser() user: JwtClaims, @Query("q") q?: string) {
    const query = q?.trim() ?? "";
    if (query.length < 2) return { leads: [], emails: [], social: [], upwork: [] };
    return this.search.search(user, query);
  }
}
