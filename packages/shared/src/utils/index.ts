/**
 * Generates a unique visitor ID for anonymous widget users.
 */
export function generateVisitorId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `v_${timestamp}_${random}`;
}

/**
 * Formats a phone number to E.164 format for Twilio.
 */
export function formatPhoneE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.startsWith("+")) return phone.replace(/[^\d+]/g, "");
  return `+${digits}`;
}

/**
 * Calculates overall completion percentage from field counts.
 */
export function calculateCompletionPct(
  completedFields: number,
  totalFields: number
): number {
  if (totalFields === 0) return 100;
  return Math.round((completedFields / totalFields) * 100);
}

/**
 * Creates a URL-safe slug from a string.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Truncates text to a maximum length with ellipsis.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

export {
  getRateLimiter,
  getTierForPath,
  getRateLimitHeaders,
  RATE_LIMITS,
  type RateLimitTier,
} from "./rate-limiter";

export {
  logger,
  createRouteLogger,
  type Logger,
} from "./logger";
