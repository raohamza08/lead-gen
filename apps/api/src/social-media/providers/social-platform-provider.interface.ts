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

/** Thrown instead of PlatformNotConfiguredError when a feature is
 *  permanently unavailable on this platform's public API — not a
 *  credentials/setup problem an operator could fix by reconnecting (Part:
 *  "no extra options for what a platform doesn't support", 2026-09-07).
 *  A connected LinkedIn/X/TikTok/WhatsApp account hitting listFeed() or
 *  listConversations() is the common case: PlatformNotConfiguredError's
 *  "is not connected" wording was actively misleading there, since the
 *  account IS connected and reconnecting changes nothing. */
export class PlatformCapabilityUnavailableError extends Error {
  constructor(platform: string, detail: string) {
    super(`${platform}: ${detail}`);
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
  /** Whether provider.likePost/likeComment are actually implemented (Part:
   *  Social Hub Engagement — like posts and comments, 2026-09-07). Kept
   *  separate from `comments` since a platform can support reading/replying
   *  to comments without exposing a like endpoint at all (true of every
   *  platform here except Facebook today). */
  likes: boolean;
  mediaTypes: string[];
  notes: string;
}

/** An OAuth app's own client id/secret, resolved by the caller (Part:
 *  per-account OAuth app credentials, 2026-09-07) before it ever reaches a
 *  provider -- providers don't look these up themselves anymore. Omitted
 *  (undefined) means "use this platform's env-var default app," the same
 *  behavior every provider had before this existed; every method below
 *  that accepts this falls back to its own internal default when it's not
 *  passed, so a deployment with no custom apps configured is unaffected. */
export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
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

/** Account-level metrics from a platform's official insights/analytics
 *  endpoint (Part: Social Hub Analytics, 2026-09-07). Every field is
 *  optional and independent — a provider only fills in what its own API
 *  actually returns for that account right now, never a placeholder or a
 *  derived guess for a field the platform doesn't expose (same "do not
 *  fabricate" rule FeedItem/SocialPlatformCapabilities already follow).
 *  Only implemented where `capabilities.analytics` is true. */
export interface AccountInsights {
  followerCount?: number;
  followingCount?: number;
  postsCount?: number;
  reach?: number;
  impressions?: number;
  engagementRate?: number;
  likeCount?: number;
  commentCount?: number;
  shareCount?: number;
  saveCount?: number;
}

/** One item in an account's own feed (Part: Social Media Hub — feed tab).
 *  `isOwnPost` is set by the caller (SocialMediaService), matched against
 *  our own SocialPostVersion.externalPostId — the provider itself has no
 *  concept of "ours", it just reports what the platform returns.
 *
 *  `mediaUrl`/`videoUrl` are deliberately separate fields, not one URL the
 *  frontend has to sniff (Part: feed video rendering fix, 2026-09-07) —
 *  Instagram's Graph API `media_url` field returns the raw playable video
 *  FILE for a VIDEO post, not a thumbnail, which silently rendered as a
 *  broken image when treated the same as a photo post's URL. `mediaUrl` is
 *  always safe to put in an <img>; `videoUrl`, only set when `mediaType` is
 *  "VIDEO", is the real playable file for a <video> element. */
export interface FeedItem {
  externalPostId: string;
  content: string;
  mediaUrl?: string;
  videoUrl?: string;
  mediaType?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "OTHER";
  permalink?: string;
  postedAt: Date;
  likeCount: number;
  commentCount: number;
  isOwnPost?: boolean;
}

/** A comment on one of OUR OWN published posts (Part: Social Hub
 *  Engagement, 2026-09-07) — distinct from a DM Conversation/
 *  ConversationMessage below: a comment is attached to a post, not a
 *  thread with one other party, and platforms don't distinguish "read"
 *  state on comments the way they do for messages. */
export interface EngagementComment {
  externalCommentId: string;
  externalPostId: string;
  parentCommentId?: string;
  authorExternalId?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  text?: string;
  postedAt: Date;
  /** True for a reply we already posted through this system on a prior
   *  sync/webhook — lets the ingest layer mark a comment RESPONDED without
   *  guessing from timing alone. */
  fromUs: boolean;
}

export interface Conversation {
  /// The platform's own thread id -- needed to call listMessages() on this
  /// same conversation. NOT stable enough to use as a storage/dedup key on
  /// its own (see participantExternalId below).
  externalConversationId: string;
  /// The other party's platform user id (e.g. Meta's PSID). This, not
  /// externalConversationId, is what a real-time webhook payload actually
  /// carries (it has no concept of "thread id"), so it's the identity key
  /// SocialInboxIngestService persists conversations under -- both
  /// ingestion paths (webhook, reconciliation poll) must resolve to the
  /// same conversation row for the same contact.
  participantExternalId: string;
  participantName: string;
  participantAvatarUrl?: string;
  lastMessageSnippet?: string;
  lastMessageAt: Date;
  unread: boolean;
}

export interface ConversationMessage {
  externalMessageId: string;
  fromUs: boolean;
  senderName: string;
  text: string;
  sentAt: Date;
}

export interface SocialPlatformProvider {
  readonly platform: string;
  readonly capabilities: SocialPlatformCapabilities;

  /** Builds the authorization redirect URL. Throws PlatformNotConfiguredError
   *  if this platform's OAuth client id isn't set in env AND no `credentials`
   *  override was passed (Part: per-account OAuth app credentials,
   *  2026-09-07 — see OAuthCredentials' own docblock). */
  getOAuthUrl(state: string, redirectUri: string, credentials?: OAuthCredentials): string;

  /** Exchanges the callback `code` for tokens + the connected account's
   *  own profile info, used to populate/refresh a SocialAccount row. Returns
   *  every account the authorization actually resolved to — for most
   *  platforms that's always one, but a Facebook/Instagram login can manage
   *  several Pages at once, and every one of them must come back here rather
   *  than silently picking one (Part: multi-account OAuth picker).
   *
   *  `codeVerifier` is only meaningful for providers whose getOAuthUrl sent a
   *  PKCE `code_challenge` (X, today) — the caller looks it up from the same
   *  OAuthStateStore entry `state` round-tripped through, and every other
   *  provider just ignores it. `credentials` must be the exact same value
   *  (or absence of one) passed to the getOAuthUrl call that started this
   *  flow — a mismatched app can't exchange another app's authorization code. */
  exchangeCodeForToken(code: string, redirectUri: string, codeVerifier?: string, credentials?: OAuthCredentials): Promise<ConnectedAccountProfile[]>;

  /** `credentials` here must resolve from the SAME app the account was
   *  originally connected with (SocialAccount.oauthAppId) -- refreshing
   *  against a different app's client id/secret than issued the original
   *  token fails outright on every platform that supports refresh at all. */
  refreshAccessToken(account: SocialAccount, credentials?: OAuthCredentials): Promise<{ accessToken: string; expiresAt?: Date }>;

  publish(account: SocialAccount, input: PublishInput): Promise<PublishResult>;

  /** Optional: only present on a provider whose `capabilities.analytics` is
   *  true (Facebook, Instagram, X, YouTube today — LinkedIn/TikTok/WhatsApp
   *  omit this entirely rather than implementing a fake empty version, same
   *  convention as subscribeWebhook above). Called by
   *  SocialAnalyticsSyncWorker on its own schedule, never on a request path. */
  getAccountInsights?(account: SocialAccount): Promise<AccountInsights>;

  /** Optional: only present where `capabilities.comments` is true and
   *  reading comments doesn't require a permission this app's OAuth scope
   *  doesn't request (Facebook, Instagram, YouTube today). Returns comments
   *  across the account's recent posts, not paginated exhaustively in V1 --
   *  same scope as listFeed's own recency limit. */
  listComments?(account: SocialAccount): Promise<EngagementComment[]>;

  /** Posts a reply to one comment. Returns the reply's own new comment id
   *  so the caller can record it as `fromUs` without a second fetch. */
  replyToComment?(account: SocialAccount, externalCommentId: string, text: string): Promise<{ externalCommentId: string }>;

  /** Optional: only present where a platform's public API actually exposes
   *  a write "like" endpoint (Part: Social Hub Engagement — like posts and
   *  comments, 2026-09-07). Idempotent per the underlying platform API's own
   *  contract — calling it on an already-liked object is a harmless no-op,
   *  not an error, so callers don't need to check "already liked" first. */
  likePost?(account: SocialAccount, externalPostId: string): Promise<void>;

  /** Same idempotency contract as likePost above, addressed at a comment
   *  instead of a post. */
  likeComment?(account: SocialAccount, externalCommentId: string): Promise<void>;

  /** Recent posts on this account with current engagement counts (Part:
   *  Social Media Hub). Throws PlatformNotConfiguredError with a real
   *  explanation on platforms with no read API for this — never returns a
   *  fake empty list, same "do not create a fake implementation" rule as
   *  every other method here. */
  listFeed(account: SocialAccount): Promise<FeedItem[]>;

  listConversations(account: SocialAccount): Promise<Conversation[]>;

  /** `conversationId` here is the platform's own thread id
   *  (Conversation.externalConversationId from listConversations above),
   *  not the participant id -- fetching message history needs the real
   *  thread, unlike sendMessage below. */
  listMessages(account: SocialAccount, conversationId: string): Promise<ConversationMessage[]>;

  /** A human clicked send (Part: Social Media Hub / Unified DM Monitoring —
   *  explicitly human-in-the-loop, never automatic, one direct synchronous
   *  API call). `participantId` is the recipient's platform user id
   *  (Conversation.participantExternalId) — this is what the Send API
   *  actually addresses a reply to, not the thread id listMessages uses. */
  sendMessage(account: SocialAccount, participantId: string, text: string): Promise<void>;

  /** One-time, called right after a successful connect (Part: Unified Social
   *  Media DM Monitoring) — tells the platform to start pushing this
   *  account's messages to our webhook. Optional: only Meta platforms
   *  (Facebook/Instagram) support a real messaging webhook at all; every
   *  other provider simply omits this rather than implementing a no-op, so
   *  its absence is visible in the type rather than a silent empty method. */
  subscribeWebhook?(account: SocialAccount): Promise<void>;
}
