import { Controller, Get, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { MetaAdsService } from "./meta-ads.service";

/** Public, unauthenticated-by-design landing point for Meta's OAuth
 *  redirect — same reasoning as SocialOAuthCallbackController: the browser
 *  arrives here straight from facebook.com with no way to carry our JWT
 *  along. `state` (see MetaAdsOAuthStateStore) ties this back to the org/
 *  user who started the connection. */
@Controller()
export class MetaAdsOAuthCallbackController {
  constructor(private readonly service: MetaAdsService) {}

  @Get("meta-ads-oauth/callback")
  async callback(@Query("code") code: string | undefined, @Query("state") state: string | undefined, @Res() res: Response) {
    const redirectTo = await this.service.handleOAuthCallback(code, state);
    res.redirect(redirectTo);
  }
}
