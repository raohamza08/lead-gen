import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";

export interface PendingMetaOAuthConnection {
  orgId: string;
  userId: string;
}

const TTL_MS = 10 * 60 * 1000; // same window as the Social Media module's OAuthStateStore

/** Round-trips who initiated a Meta Ads connect through the redirect to
 *  Meta's consent screen and back — same reasoning as social-media's own
 *  OAuthStateStore (the callback lands on a public, unauthenticated route,
 *  so `state` is the only thread back to a known org/user). A dedicated
 *  store rather than reusing social-media's (Part: standing decision, Meta
 *  Ads is a separate connection) keeps this module free of a cross-module
 *  dependency on Social Media for something this small. */
@Injectable()
export class MetaAdsOAuthStateStore {
  private readonly pending = new Map<string, { value: PendingMetaOAuthConnection; expiresAt: number }>();

  create(value: PendingMetaOAuthConnection): string {
    this.sweep();
    const state = randomUUID();
    this.pending.set(state, { value, expiresAt: Date.now() + TTL_MS });
    return state;
  }

  /** Single-use — consumed on the callback so a replayed callback URL can't reuse it. */
  consume(state: string): PendingMetaOAuthConnection | null {
    const entry = this.pending.get(state);
    this.pending.delete(state);
    if (!entry || entry.expiresAt < Date.now()) return null;
    return entry.value;
  }

  private sweep() {
    const now = Date.now();
    for (const [key, entry] of this.pending) {
      if (entry.expiresAt < now) this.pending.delete(key);
    }
  }
}
