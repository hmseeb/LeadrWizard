import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Lazy init to avoid boot failures when env vars missing (build time, tests)
let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) {
    redis = Redis.fromEnv();
  }
  return redis;
}

export const RATE_LIMITS = {
  webhook: { requests: 100, window: "60 s" as const },
  api: { requests: 60, window: "60 s" as const },
  widget: { requests: 60, window: "60 s" as const },
  auth: { requests: 10, window: "60 s" as const },
  signup: { requests: 10, window: "60 s" as const },
  cron: { requests: 5, window: "60 s" as const },
} as const;

export type RateLimitTier = keyof typeof RATE_LIMITS;

const limiters = new Map<string, Ratelimit>();

export function getRateLimiter(tier: RateLimitTier): Ratelimit {
  if (!limiters.has(tier)) {
    const config = RATE_LIMITS[tier];
    limiters.set(
      tier,
      new Ratelimit({
        redis: getRedis(),
        limiter: Ratelimit.slidingWindow(config.requests, config.window),
        prefix: `leadrwizard:ratelimit:${tier}`,
        analytics: true,
      })
    );
  }
  return limiters.get(tier)!;
}

export function getTierForPath(pathname: string): RateLimitTier {
  if (pathname.startsWith("/api/webhooks/")) return "webhook";
  if (pathname.startsWith("/api/widget/")) return "widget";
  if (pathname.startsWith("/api/signup/")) return "signup";
  if (pathname.startsWith("/api/cron/")) return "cron";
  return "api";
}

export function getRateLimitHeaders(result: {
  remaining: number;
  reset: number;
}): Record<string, string> {
  return {
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
  };
}
