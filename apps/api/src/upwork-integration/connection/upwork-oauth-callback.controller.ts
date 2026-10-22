import { Controller, Get, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { UpworkApiConnectionService } from "./upwork-api-connection.service";

/**
 * Public, unauthenticated-by-design landing point for Upwork's OAuth
 * redirect — same reasoning as SocialOAuthCallbackController and
 * MetaAdsOAuthCallbackController: the browser arrives here straight from
 * upwork.com with no way to carry our JWT along. `state` (see
 * UpworkOAuthStateStore) ties this back to the org/user who started the
 * connection.
 *
 * This is the exact path Upwork's app-registration form needs as the
 * callback/redirect URL: {API_PUBLIC_URL}/upwork-oauth/callback. Excluded
 * from the global "api/v1" prefix in main.ts (alongside social-oauth and
 * meta-ads-oauth) for the same reason those are.
 */
@Controller()
export class UpworkOAuthCallbackController {
  constructor(private readonly service: UpworkApiConnectionService) {}

  @Get("upwork-oauth/callback")
  async callback(@Query("code") code: string | undefined, @Query("state") state: string | undefined, @Res() res: Response) {
    const redirectTo = await this.service.handleOAuthCallback(code, state);
    res.redirect(redirectTo);
  }
}
