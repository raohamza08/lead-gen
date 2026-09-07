import { ConfigService } from "@nestjs/config";
import { OAuthCredentials } from "./social-platform-provider.interface";

/**
 * Every provider's single credential-resolution point (Part: per-account
 * OAuth app credentials, 2026-09-07) — an explicit `OAuthCredentials`
 * (resolved by SocialMediaService from a SocialAccount's own
 * SocialOAuthApp, or the platform-wide default) always wins; falling back
 * to the platform's env vars is what makes every existing connection
 * (made before this feature existed, with no oauthAppId) keep working
 * unchanged. One function shared by all seven providers instead of each
 * reimplementing the same two-line fallback.
 */
export function resolveOAuthCredentials(
  explicit: OAuthCredentials | undefined,
  config: ConfigService,
  envClientIdKey: string,
  envClientSecretKey: string,
): { clientId?: string; clientSecret?: string } {
  if (explicit) return explicit;
  return {
    clientId: config.get<string>(envClientIdKey),
    clientSecret: config.get<string>(envClientSecretKey),
  };
}
