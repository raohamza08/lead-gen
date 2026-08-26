import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { SocialPlatform } from "@prisma/client";
import { ConnectedAccountProfile } from "./providers/social-platform-provider.interface";

export interface PendingAccountSelection {
  orgId: string;
  userId: string;
  platform: SocialPlatform;
  profiles: ConnectedAccountProfile[];
}

const TTL_MS = 10 * 60 * 1000; // same window as OAuthStateStore — plenty to read a short list and click one

/**
 * Sibling of OAuthStateStore (Part: multi-account OAuth picker), but for a
 * different moment: OAuthStateStore round-trips the *intent* to connect
 * across the redirect to the platform; this store holds what came *back* —
 * every account one authorization resolved to — for the picker UI to read
 * after the callback already landed. Deliberately not single-use like
 * OAuthStateStore.consume: a Facebook/Instagram login can resolve to several
 * Pages, and the operator should be able to connect more than one of them
 * without re-authenticating for each, so entries are read with `get`, not
 * consumed, and just expire naturally after the TTL. In-memory and
 * single-process, same acceptable V1 limitation as its sibling — an API
 * restart mid-pick just needs the connect attempt retried.
 */
@Injectable()
export class PendingAccountSelectionStore {
  private readonly pending = new Map<string, { value: PendingAccountSelection; expiresAt: number }>();

  create(value: PendingAccountSelection): string {
    this.sweep();
    const id = randomUUID();
    this.pending.set(id, { value, expiresAt: Date.now() + TTL_MS });
    return id;
  }

  get(id: string): PendingAccountSelection | null {
    const entry = this.pending.get(id);
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
