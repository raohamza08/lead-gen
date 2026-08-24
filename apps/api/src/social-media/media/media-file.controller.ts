import { Controller, Get, Inject, NotFoundException, Param, Res } from "@nestjs/common";
import { Response } from "express";
import { PrismaService } from "../../common/prisma/prisma.service";
import { MEDIA_STORAGE_SERVICE, MediaStorageService } from "./media-storage.interface";

/**
 * Public, unauthenticated-by-design (same pattern as TrackingController's
 * open-pixel route) — deliberately, not an oversight: platform publish APIs
 * (Instagram/Facebook's media container step, in particular) fetch media by
 * URL themselves and can't present a session cookie or JWT to get it. The
 * UUID-keyed MediaAsset id is the only access control; nothing sensitive
 * should be uploaded through this module on that basis.
 */
@Controller()
export class MediaFileController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE_SERVICE) private readonly storage: MediaStorageService,
  ) {}

  @Get("media/:mediaAssetId")
  async serve(@Param("mediaAssetId") mediaAssetId: string, @Res() res: Response) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
    if (!asset) throw new NotFoundException("Media not found");

    const buffer = await this.storage.read(asset.storageKey);
    res.set({
      "Content-Type": asset.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(asset.filename)}"`,
      "Cache-Control": "public, max-age=31536000, immutable", // storageKey is UUID-per-upload — content at this URL never changes
    });
    res.send(buffer);
  }
}
