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

/** One item in an account's own feed (Part: Social Media Hub — feed tab).
 *  `isOwnPost` is set by the caller (SocialMediaService), matched against
 *  our own SocialPostVersion.externalPostId — the provider itself has no
 *  concept of "ours", it just reports what the platform returns. */
export interface FeedItem {
  externalPostId: string;
  content: string;
  mediaUrl?: string;
  permalink?: string;
  postedAt: Date;
  likeCount: number;
  commentCount: number;
  isOwnPost?: boolean;
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
}
