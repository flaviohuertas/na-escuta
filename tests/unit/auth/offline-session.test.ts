import { SignJWT, exportJWK, generateKeyPair, importJWK } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";
import type { OfflineSession } from "@/lib/db/dexie/schema";

const userId = "01991b1a-0000-7000-8000-000000000001";
const companyId = "01991b1a-0000-7000-8000-000000000002";
const eventId = "01991b1a-0000-7000-8000-000000000003";

async function signTestGrant(privateKey: CryptoKey, overrides: Partial<Record<string, unknown>> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    companyId,
    deviceId: "device-1",
    companyRole: "PRODUCER",
    eventAccess: [{ eventId, role: "MANAGER" }],
    ...overrides,
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + 7 * 24 * 60 * 60)
    .sign(privateKey);
}

describe("offline-session", () => {
  let privateKey: CryptoKey;

  beforeEach(async () => {
    const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    privateKey = pair.privateKey as CryptoKey;
    const publicJwk = await exportJWK(pair.publicKey);
    vi.stubEnv("NEXT_PUBLIC_OFFLINE_GRANT_PUBLIC_KEY_JWK", JSON.stringify(publicJwk));
    resetDbInstanceForTests();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  it("verifica um grant assinado corretamente e extrai o payload", async () => {
    const { verifyOfflineGrantJwt } = await import("@/lib/auth/offline-session");
    const jwt = await signTestGrant(privateKey);

    const result = await verifyOfflineGrantJwt(jwt);

    expect(result.payload.sub).toBe(userId);
    expect(result.payload.companyId).toBe(companyId);
    expect(result.payload.eventAccess).toEqual([{ eventId, role: "MANAGER" }]);
  });

  it("rejeita um grant assinado com outra chave privada", async () => {
    const { verifyOfflineGrantJwt } = await import("@/lib/auth/offline-session");
    const otherPair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const forgedJwt = await signTestGrant(otherPair.privateKey as CryptoKey);

    await expect(verifyOfflineGrantJwt(forgedJwt)).rejects.toThrow();
  });

  it("armazena e recupera a sessão offline via Dexie", async () => {
    const { storeOfflineSession, getStoredOfflineSession } = await import("@/lib/auth/offline-session");
    const jwt = await signTestGrant(privateKey);

    await storeOfflineSession({ jwt, serverTime: new Date().toISOString() });
    const stored = await getStoredOfflineSession();

    expect(stored?.userId).toBe(userId);
    expect(stored?.companyId).toBe(companyId);
  });

  it("checkOfflineSessionValidity: válida enquanto o tempo efetivo não passar do exp", async () => {
    const { checkOfflineSessionValidity } = await import("@/lib/auth/offline-session");
    const nowMs = Date.now();
    vi.spyOn(performance, "now").mockReturnValue(1_000_000);

    const session: OfflineSession = {
      key: "current",
      userId,
      companyId,
      deviceId: "device-1",
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
      permissionsSnapshot: { companyRole: "PRODUCER", eventAccess: [{ eventId, role: "MANAGER" }] },
      jwt: "irrelevante-aqui",
      lastVerifiedServerTime: new Date(nowMs).toISOString(),
      monotonicAnchorMs: 1_000_000, // mesmo instante -> elapsed = 0
    };

    expect(checkOfflineSessionValidity(session).valid).toBe(true);
  });

  it("checkOfflineSessionValidity: expira quando o tempo monotônico decorrido ultrapassa o exp, mesmo sem tocar em Date.now()", async () => {
    const { checkOfflineSessionValidity } = await import("@/lib/auth/offline-session");
    const nowMs = Date.now();
    const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
    // performance.now() avançou 8 dias desde a âncora — simula o app ficando
    // aberto/rodando (sem fechar) por mais tempo que a validade do grant.
    vi.spyOn(performance, "now").mockReturnValue(1_000_000 + eightDaysMs);

    const session: OfflineSession = {
      key: "current",
      userId,
      companyId,
      deviceId: "device-1",
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
      permissionsSnapshot: { companyRole: "PRODUCER", eventAccess: [] },
      jwt: "irrelevante-aqui",
      lastVerifiedServerTime: new Date(nowMs).toISOString(),
      monotonicAnchorMs: 1_000_000,
    };

    const check = checkOfflineSessionValidity(session);
    expect(check.valid).toBe(false);
    expect(check.reason).toBe("expired");
  });

  it("checkOfflineSessionValidity: não é enganado apenas adiantando o relógio do sistema (Date.now), já que usa a âncora monotônica", async () => {
    const { checkOfflineSessionValidity } = await import("@/lib/auth/offline-session");
    const nowMs = Date.now();
    vi.spyOn(performance, "now").mockReturnValue(1_000_000); // nenhum tempo real decorrido

    const session: OfflineSession = {
      key: "current",
      userId,
      companyId,
      deviceId: "device-1",
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + 1000).toISOString(), // expira em 1s "de verdade"
      permissionsSnapshot: { companyRole: "PRODUCER", eventAccess: [] },
      jwt: "irrelevante-aqui",
      lastVerifiedServerTime: new Date(nowMs).toISOString(),
      monotonicAnchorMs: 1_000_000,
    };

    // Mesmo que o relógio do sistema (Date.now) seja adiantado em 1 ano por
    // fora, checkOfflineSessionValidity não usa Date.now() para "agora" —
    // usa a âncora monotônica, que não se moveu.
    vi.useFakeTimers();
    vi.setSystemTime(nowMs + 365 * 24 * 60 * 60 * 1000);
    try {
      expect(checkOfflineSessionValidity(session).valid).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
