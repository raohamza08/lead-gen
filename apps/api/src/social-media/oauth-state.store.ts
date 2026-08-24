import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";

export interface PendingOAuthConnection {
  orgId: string;
  userId: string;
  platform: string;
  accountId?: string; // set when connecting a pre-created placeholder row rather than creating fresh
  pkceVerifier?: string;
}

const TTL_MS = 10 * 60 * 1000; // an operator needs long enough to actually complete the platform's consent screen

/**
 * Round-trips who initiated an OAuth connect through the redirect to an
 * external platform and back — the callback lands on a public,
 * unauthenticated route (the browser can't carry our JWT to a third-party
 * domain and back), so `state` is the only thread connecting the callback
 * to a known org/user. In-memory and single-process by design: if the API
 * restarts mid-flow the connect attempt just needs retrying, which is an
 * acceptable V1 limitation for a low-frequency, operator-initiated action.
 */
@Injectable()
export class OAuthStateStore {
  private readonly pending = new Map<string, { value: PendingOAuthConnection; expiresAt: number }>();

  create(value: PendingOAuthConnection): string {
    this.sweep();
    const state = randomUUID();
    this.pending.set(state, { value, expiresAt: Date.now() + TTL_MS });
    return state;
  }

  /** Single-use — consumed on the callback so a replayed callback URL can't reuse it. */
  consume(state: string): PendingOAuthConnection | null {
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
