import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import { MediaStorageService, SavedMedia } from "./media-storage.interface";

/**
 * V1 storage: the API's own workstation disk, not a cloud bucket — this app
 * runs as a local process reached via Tailscale Funnel, so there's no
 * separate host to need an external store, and adding one (S3/R2 account,
 * credentials, cost) isn't justified until this module actually needs to
 * run somewhere without persistent local disk. `storageKey` is org-scoped
 * and UUID-named on purpose — never the original filename alone, which
 * could collide or leak path segments (`../`) if used unsanitized.
 */
@Injectable()
export class LocalDiskMediaStorageService implements MediaStorageService {
  private readonly logger = new Logger(LocalDiskMediaStorageService.name);
  private readonly root: string;

  constructor(private readonly config: ConfigService) {
    this.root = this.config.get<string>("MEDIA_STORAGE_DIR") || path.join(process.cwd(), "storage", "media");
  }

  async save(input: { buffer: Buffer; orgId: string; filename: string }): Promise<SavedMedia> {
    const ext = path.extname(input.filename).slice(0, 16); // bounded — an attacker-controlled filename shouldn't dictate an unbounded path segment
    const storageKey = path.posix.join(input.orgId, `${randomUUID()}${ext}`);
    const absolutePath = this.resolve(storageKey);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.buffer);

    return { storageKey, sizeBytes: input.buffer.byteLength };
  }

  async read(storageKey: string): Promise<Buffer> {
    return fs.readFile(this.resolve(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await fs.unlink(this.resolve(storageKey)).catch((err) => {
      // Missing file on delete isn't an operator-facing error — the DB row
      // going away is what matters; log it in case it points at a real bug.
      this.logger.warn(`Could not delete ${storageKey}: ${err.message}`);
    });
  }

  /** Rejects any storageKey that would escape the storage root (defense in depth beyond the UUID-only writer above). */
  private resolve(storageKey: string): string {
    const absolutePath = path.join(this.root, storageKey);
    if (!absolutePath.startsWith(this.root + path.sep) && absolutePath !== this.root) {
      throw new Error(`Invalid storage key: ${storageKey}`);
    }
    return absolutePath;
  }
}
