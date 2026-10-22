import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";

export interface PendingUpworkOAuthConnection {
  orgId: string;
  userId: string;
}

const TTL_MS = 10 * 60 * 1000; // long enough to complete Upwork's consent screen

/**
 * Same role and same single-process, in-memory design as
 * social-media/oauth-state.store.ts and MetaAdsOAuthStateStore — `state`
 * threads the callback (a public, unauthenticated route the browser lands on
 * straight from upwork.com) back to who initiated the connect.
 */
@Injectable()
export class UpworkOAuthStateStore {
  private readonly pending = new Map<string, { value: PendingUpworkOAuthConnection; expiresAt: number }>();

  create(value: PendingUpworkOAuthConnection): string {
    this.sweep();
    const state = randomUUID();
    this.pending.set(state, { value, expiresAt: Date.now() + TTL_MS });
    return state;
  }

  /** Single-use — consumed on the callback so a replayed callback URL can't reuse it. */
  consume(state: string): PendingUpworkOAuthConnection | null {
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
