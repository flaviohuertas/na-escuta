import { describe, expect, it } from "vitest";
import { createClientRateLimiter } from "@/server/auth/rate-limit";

describe("createClientRateLimiter", () => {
  it("bloqueia depois de várias falhas seguidas e libera após sucesso", () => {
    const limiter = createClientRateLimiter({ maxAttempts: 3, windowMs: 60_000, lockoutMs: 5_000 });

    expect(limiter.beforeRequest("user-1").allowed).toBe(true);

    expect(limiter.recordFailure("user-1").allowed).toBe(true);
    expect(limiter.recordFailure("user-1").allowed).toBe(true);
    expect(limiter.recordFailure("user-1").allowed).toBe(false);

    const blocked = limiter.beforeRequest("user-1");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    limiter.recordSuccess("user-1");
    expect(limiter.beforeRequest("user-1").allowed).toBe(true);
  });
});
