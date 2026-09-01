import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { Response } from "express";
import { UsersService } from "./users.service";

/**
 * Public, unauthenticated-by-design — same reasoning and same pattern as
 * MediaFileController for social assets. A plain `<img src>` tag (how every
 * avatar is rendered — header, team list, My Profile) can't attach a Bearer
 * token, so nesting this under UsersController's class-level JwtAuthGuard
 * meant every avatar 404'd/401'd in the browser. The UUID user id is the
 * only access control, same as MediaFileController's UUID mediaAssetId.
 */
@Controller("users")
export class AvatarFileController {
  constructor(private readonly usersService: UsersService) {}

  @Get(":id/avatar")
  async getAvatar(@Param("id") id: string, @Res() res: Response) {
    const file = await this.usersService.getAvatarFile(id);
    if (!file) throw new NotFoundException("No avatar set");
    res.set({ "Content-Type": file.mimeType, "Cache-Control": "private, max-age=3600" });
    res.send(file.buffer);
  }
}
