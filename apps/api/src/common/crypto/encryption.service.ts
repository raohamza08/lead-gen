import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, the AES-GCM standard
const SALT = "leadgen-email-hub-credential-encryption"; // fixed, non-secret — the key material is ENCRYPTION_KEY, this only derives a 32-byte key from it

/**
 * AES-256-GCM at-rest encryption for mailbox credentials (IMAP/SMTP
 * passwords, OAuth refresh tokens) — the first encryption utility anywhere
 * in this codebase. Before this, EmailAccount.smtpPassword/oauthRefreshToken
 * were plaintext Prisma columns (see the TODO that used to sit on that
 * model). Ciphertext is stored as `iv:authTag:ciphertext`, all hex, so it
 * fits in a single String column without a schema shape change.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get<string>("ENCRYPTION_KEY");
    if (!secret) {
      // Fails loudly at boot rather than silently storing plaintext or
      // crashing only the first time a credential is saved.
      throw new Error(
        "ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and set it in .env before starting the API.",
      );
    }
    this.key = scryptSync(secret, SALT, 32);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
  }

  decrypt(stored: string): string {
    const [ivHex, authTagHex, ciphertextHex] = stored.split(":");
    if (!ivHex || !authTagHex || !ciphertextHex) {
      throw new Error("Malformed ciphertext — expected iv:authTag:ciphertext");
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  }

  /** True if `stored` looks like our ciphertext format rather than a legacy
   *  plaintext value — lets callers migrate old plaintext rows on read
   *  without a separate backfill pass blocking this feature. */
  looksEncrypted(stored: string | null | undefined): boolean {
    if (!stored) return false;
    const parts = stored.split(":");
    return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
  }
}
