/**
 * In-memory rate limiter for API endpoints.
 * Uses a sliding window approach.
 *
 * For production with multiple instances, use Redis-based rate limiting.
 * This works well for single-instance / serverless with warm containers.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) {
      store.delete(key);
    }
  }
}, 60 * 1000); // Every minute

export interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Check if a request is within rate limits.
 */
export function checkRateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    // New window
    store.set(key, {
      count: 1,
      resetAt: now + config.windowSeconds * 1000,
    });
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: now + config.windowSeconds * 1000,
    };
  }

  if (entry.count >= config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Pre-configured rate limits for different endpoint types.
 */
export const RATE_LIMITS = {
  /** Webhook endpoints: 100 req/min */
  webhook: { maxRequests: 100, windowSeconds: 60 },
  /** API endpoints: 60 req/min */
  api: { maxRequests: 60, windowSeconds: 60 },
  /** Auth endpoints: 10 req/min */
  auth: { maxRequests: 10, windowSeconds: 60 },
  /** Cron endpoints: 5 req/min */
  cron: { maxRequests: 5, windowSeconds: 60 },
} as const;

/**
 * Helper to apply rate limiting to a Next.js API route.
 * Returns headers object if allowed, throws if rate limited.
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}
