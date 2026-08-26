import { SocialAccount } from "@prisma/client";

/**
 * Abstracted platform interface (Part: API & Provider Architecture) —
 * mirrors EmailProvider (send) and MailboxReader (IMAP sync) elsewhere in
 * this codebase: one interface, one adapter per platform, the core
 * application never talks to a platform's HTTP API directly. Adding a
 * platform later means adding a file here, not touching the module that
 * calls it.
 *
 * Every method that would hit a real platform API throws
 * `PlatformNotConfiguredError` until that platform's OAuth app credentials
 * are actually set (Part: Platform API Limitations — "do not create a fake
 * implementation"). This is the mechanism, not a placeholder: a post
 * scheduled against an unconnected account fails cleanly with this error
 * as its `publishError`, which is exactly the honest behavior Failed
 * Publishing requires.
 */

/** Thrown by every provider method when the platform has no real
 *  credentials configured yet (env vars unset) or the specific account has
 *  no token. Distinct from a genuine API error so callers — and the UI —
 *  can tell "not set up" from "set up but broken." */
export class PlatformNotConfiguredError extends Error {
  constructor(platform: string, detail: string) {
    super(`${platform} is not connected: ${detail}`);
  }
}

/** What a platform's official API actually supports, declared honestly per
 *  platform rather than assumed uniform (Part: Platform API Limitations).
 *  The UI reads this to grey out / explain unavailable actions instead of
 *  offering a button that would fail. `notes` is shown directly to the
 *  operator, so keep it accurate and specific — it is not marketing copy. */
export interface SocialPlatformCapabilities {
  publish: boolean;
  /** Native scheduled publishing via the platform's own API (independent
   *  of our own worker, which can "schedule" anything by just waiting to
   *  call publish() at the right time regardless of this flag). */
  nativeScheduling: boolean;
  analytics: boolean;
  comments: boolean;
  dms: boolean;
  mediaTypes: string[];
  notes: string;
}

export interface ConnectedAccountProfile {
  externalAccountId: string;
  username: string;
  displayName?: string;
  profileImageUrl?: string;
  accountType?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface PublishInput {
  content: string;
  hashtags: string[];
  /** Publicly fetchable URLs (via MediaStorageService's served path) —
   *  every platform's publish API wants a URL it can fetch, not a raw
   *  upload stream, for the create-media step. */
  mediaUrls: string[];
}

export interface PublishResult {
  externalPostId: string;
}

export interface SocialPlatformProvider {
  readonly platform: string;
  readonly capabilities: SocialPlatformCapabilities;

  /** Builds the authorization redirect URL. Throws PlatformNotConfiguredError
   *  if this platform's OAuth client id isn't set in env. */
  getOAuthUrl(state: string, redirectUri: string): string;

  /** Exchanges the callback `code` for tokens + the connected account's
   *  own profile info, used to populate/refresh a SocialAccount row. Returns
   *  every account the authorization actually resolved to — for most
   *  platforms that's always one, but a Facebook/Instagram login can manage
   *  several Pages at once, and every one of them must come back here rather
   *  than silently picking one (Part: multi-account OAuth picker). */
  exchangeCodeForToken(code: string, redirectUri: string): Promise<ConnectedAccountProfile[]>;

  refreshAccessToken(account: SocialAccount): Promise<{ accessToken: string; expiresAt?: Date }>;

  publish(account: SocialAccount, input: PublishInput): Promise<PublishResult>;
}
