import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { SocialPlatform } from "@prisma/client";
import { SocialMediaService } from "./social-media.service";

/**
 * Public, unauthenticated-by-design landing point for every platform's
 * OAuth redirect (same reasoning as TrackingController/MediaFileController):
 * the browser arrives here straight from Facebook/LinkedIn/X/TikTok/Google,
 * with no way to carry our JWT along. `state` (see OAuthStateStore) is what
 * ties this request back to the org/user who started the connection.
 */
@Controller()
export class SocialOAuthCallbackController {
  constructor(private readonly service: SocialMediaService) {}

  @Get("social-oauth/callback/:platform")
  async callback(
    @Param("platform") platform: SocialPlatform,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Res() res: Response,
  ) {
    const redirectTo = await this.service.handleOAuthCallback(platform, code, state);
    res.redirect(redirectTo);
  }
}
