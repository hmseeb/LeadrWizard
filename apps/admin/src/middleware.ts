import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getRateLimiter, getTierForPath } from "@leadrwizard/shared/utils";

const RATE_LIMITED_PREFIXES = [
  "/api/webhooks/",
  "/api/widget/",
  "/api/signup/",
  "/api/cron/",
];

function isRateLimited(pathname: string): boolean {
  return RATE_LIMITED_PREFIXES.some((p) => pathname.startsWith(p));
}

export async function middleware(request: NextRequest) {
  // --- Correlation ID ---
  const correlationId = crypto.randomUUID();
  request.headers.set("x-correlation-id", correlationId);

  // --- Rate Limiting (public endpoints only) ---
  if (isRateLimited(request.nextUrl.pathname)) {
    try {
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        request.headers.get("x-real-ip") ??
        "unknown";
      const tier = getTierForPath(request.nextUrl.pathname);
      const limiter = getRateLimiter(tier);
      const { success, reset } = await limiter.limit(`${tier}:${ip}`);

      if (!success) {
        return NextResponse.json(
          { error: "Too many requests" },
          {
            status: 429,
            headers: {
              "Retry-After": String(Math.ceil((reset - Date.now()) / 1000)),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(Math.ceil(reset / 1000)),
              "x-correlation-id": correlationId,
            },
          }
        );
      }
    } catch {
      // If Upstash is unreachable (e.g. env vars missing in dev), fail open.
      // Don't block requests because of a rate limiter outage.
    }
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users to login
  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/callback") &&
    !request.nextUrl.pathname.startsWith("/api/webhooks") &&
    !request.nextUrl.pathname.startsWith("/api/cron") &&
    !request.nextUrl.pathname.startsWith("/api/signup") &&
    !request.nextUrl.pathname.startsWith("/api/widget") &&
    !request.nextUrl.pathname.startsWith("/signup")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login
  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Add correlation ID to response headers for debugging
  supabaseResponse.headers.set("x-correlation-id", correlationId);

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
