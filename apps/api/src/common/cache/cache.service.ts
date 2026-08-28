import { Injectable, Logger } from "@nestjs/common";
import { getRedisConnection } from "../queue/redis-connection";

/**
 * Server-side read-through cache (Part: page-load speed) — a stopgap for
 * this app's dominant latency source: the Hetzner VPS and the Supabase
 * database sit in different regions (Nuremberg vs ap-southeast-1), so every
 * DB round trip pays ~200-400ms before a query even runs, confirmed live.
 * React Query's client-side staleTime already absorbs this for repeat
 * navigation within one browser tab; this absorbs it server-side, for every
 * client, on first load too. Short TTLs are deliberate — this trades a few
 * seconds of staleness for a real latency cut, not correctness.
 *
 * Reuses the shared BullMQ Redis connection rather than opening a second
 * one — get/set/del are non-blocking commands, so sharing is safe (only
 * blocking commands like BRPOPLPUSH would need a dedicated connection).
 * Every operation swallows its own Redis errors and falls through to the
 * real fetch — a cache outage must never turn into a feature outage.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis = getRedisConnection();

  async getOrSet<T>(key: string, ttlSeconds: number, fetch: () => Promise<T>): Promise<T> {
    const cached = await this.redis.get(key).catch((err) => {
      this.logger.warn(`Cache read failed for ${key}: ${(err as Error).message}`);
      return null;
    });
    if (cached !== null) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        // Corrupt/stale-shape entry — fall through to a real fetch below.
      }
    }

    const value = await fetch();
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds).catch((err) => {
      this.logger.warn(`Cache write failed for ${key}: ${(err as Error).message}`);
    });
    return value;
  }

  async invalidate(key: string): Promise<void> {
    await this.redis.del(key).catch((err) => {
      this.logger.warn(`Cache invalidate failed for ${key}: ${(err as Error).message}`);
    });
  }
}
