export type RateLimitOptions = {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;
};

type RateLimitEntry = {
  count: number;
  windowStart: number;
  blockedUntil: number;
};

const DEFAULT_RATE_LIMIT: RateLimitOptions = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
};

export function createClientRateLimiter(options: Partial<RateLimitOptions> = {}) {
  const config = { ...DEFAULT_RATE_LIMIT, ...options };
  const state = new Map<string, RateLimitEntry>();

  function resetIfExpired(ip: string, now: number) {
    const entry = state.get(ip);
    if (!entry) return;
    if (now - entry.windowStart > config.windowMs) {
      state.delete(ip);
    }
  }

  return {
    beforeRequest(ip: string, now = Date.now()) {
      const key = ip || "unknown";
      resetIfExpired(key, now);
      const entry = state.get(key);
      if (entry && entry.blockedUntil > now) {
        return { allowed: false, retryAfterMs: Math.max(0, entry.blockedUntil - now) };
      }
      if (entry && entry.blockedUntil <= now) {
        state.delete(key);
      }
      return { allowed: true };
    },
    recordFailure(ip: string, now = Date.now()) {
      const key = ip || "unknown";
      const existing = state.get(key);
      const windowStart = existing && now - existing.windowStart <= config.windowMs ? existing.windowStart : now;
      const next: RateLimitEntry = {
        count: (existing?.count ?? 0) + 1,
        windowStart,
        blockedUntil: 0,
      };

      if (next.count >= config.maxAttempts) {
        next.blockedUntil = now + config.lockoutMs;
      }

      state.set(key, next);
      const blocked = next.blockedUntil > now;
      return blocked
        ? { allowed: false, retryAfterMs: next.blockedUntil - now }
        : { allowed: true };
    },
    recordSuccess(ip: string) {
      state.delete(ip || "unknown");
    },
    snapshot(ip: string) {
      return state.get(ip || "unknown");
    },
  };
}

export const deviceStatusRateLimiter = createClientRateLimiter();
export const passwordChangeRateLimiter = createClientRateLimiter();

export function getClientIp(request: Request): string {
  const headers = request.headers;
  const forwarded = headers.get("x-forwarded-for") ?? "";
  const realIp = headers.get("x-real-ip") ?? "";
  const cloudflare = headers.get("cf-connecting-ip") ?? "";

  const first = [forwarded, realIp, cloudflare]
    .flatMap((value) => value.split(",").map((part) => part.trim()))
    .find((value) => value.length > 0);

  return first ?? "unknown";
}
