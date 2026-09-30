import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { MetaAdAccountDto } from "./meta-marketing-api.client";

export interface PendingMetaAdAccountSelection {
  orgId: string;
  userId: string;
  /** The long-lived user access token from the completed OAuth exchange —
   *  held in memory only until the operator picks which ad account(s) to
   *  connect, never persisted until selectAdAccounts writes the chosen
   *  ones' own MetaAdAccount rows (Part: Security — never round-tripped to
   *  the frontend, encrypted at rest once it does land in a row). */
  accessToken: string;
  tokenExpiresAt?: Date;
  accounts: MetaAdAccountDto[];
}

const TTL_MS = 10 * 60 * 1000;

/** Sibling of MetaAdsOAuthStateStore, same "round-trips what came back from
 *  the platform for the picker UI to read" role as social-media's
 *  PendingAccountSelectionStore — an org can have several Meta ad accounts
 *  under one Business Manager, and the operator should pick which to
 *  connect rather than the backend guessing. */
@Injectable()
export class MetaAdsPendingSelectionStore {
  private readonly pending = new Map<string, { value: PendingMetaAdAccountSelection; expiresAt: number }>();

  create(value: PendingMetaAdAccountSelection): string {
    this.sweep();
    const id = randomUUID();
    this.pending.set(id, { value, expiresAt: Date.now() + TTL_MS });
    return id;
  }

  get(id: string): PendingMetaAdAccountSelection | null {
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
