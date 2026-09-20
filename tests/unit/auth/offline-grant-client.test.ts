import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RENEW_GRANT_AFTER_MS, ensureOfflineGrant } from "@/lib/auth/offline-grant-client";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";

const USER = "01991b1a-0000-7000-8000-000000000001";
const OTHER_USER = "01991b1a-0000-7000-8000-000000000009";
const COMPANY = "01991b1a-0000-7000-8000-000000000002";
const DEVICE = "device-deste-aparelho";
// Relógio REAL, em segundos exatos: `jwtVerify` confere a expiração contra o relógio de verdade, então
// um instante fixo faria o teste quebrar sozinho quando o grant de mentira "vencesse".
const T0 = Math.floor(Date.now() / 1000) * 1000;

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

/** O que o servidor devolveria: um grant EdDSA de verdade, emitido em `issuedAtMs`. */
async function serverGrant(opts: { userId?: string; deviceId?: string; issuedAtMs?: number; key?: typeof privateKey } = {}) {
  const issuedAtMs = opts.issuedAtMs ?? T0;
  const jwt = await new SignJWT({ companyId: COMPANY, deviceId: opts.deviceId ?? DEVICE, companyRole: "STAFF", eventAccess: [] })
    .setProtectedHeader({ alg: "EdDSA" })
    .setSubject(opts.userId ?? USER)
    .setIssuedAt(Math.floor(issuedAtMs / 1000))
    .setExpirationTime(Math.floor(issuedAtMs / 1000) + 7 * 24 * 3600)
    .sign(opts.key ?? privateKey);
  return { jwt, serverTime: new Date(issuedAtMs).toISOString() };
}

const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("ensureOfflineGrant — o aparelho passa a ter identidade para o servidor", () => {
  beforeEach(async () => {
    const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    privateKey = pair.privateKey;
    vi.stubEnv("NEXT_PUBLIC_OFFLINE_GRANT_PUBLIC_KEY_JWK", JSON.stringify(await exportJWK(pair.publicKey)));
    window.localStorage.setItem("na-escuta:device-id", DEVICE);
    resetDbInstanceForTests();
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    window.localStorage.clear();
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  const now = (offsetMs = 0) => () => T0 + offsetMs;

  it("sem grant guardado, pede ao servidor (com o id deste aparelho) e guarda", async () => {
    const fetchImpl = vi.fn(async () => reply(200, await serverGrant()));

    const outcome = await ensureOfflineGrant({ userId: USER, fetchImpl: fetchImpl as unknown as typeof fetch, now: now() });

    expect(outcome).toBe("stored");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/offline-grant");
    expect(JSON.parse(String(init.body))).toEqual({ deviceId: DEVICE });
    expect(await getDb().session.get("current")).toMatchObject({ userId: USER, companyId: COMPANY, deviceId: DEVICE });
  });

  it("com um grant recente da mesma pessoa neste aparelho, não pede outro (não bate no servidor a cada abertura)", async () => {
    const first = vi.fn(async () => reply(200, await serverGrant()));
    await ensureOfflineGrant({ userId: USER, fetchImpl: first as unknown as typeof fetch, now: now() });
    const second = vi.fn();

    const outcome = await ensureOfflineGrant({ userId: USER, fetchImpl: second as unknown as typeof fetch, now: now(60 * 60 * 1000) });

    expect(outcome).toBe("fresh");
    expect(second).not.toHaveBeenCalled();
  });

  it("renova depois de um dia", async () => {
    await ensureOfflineGrant({ userId: USER, fetchImpl: (async () => reply(200, await serverGrant())) as unknown as typeof fetch, now: now() });
    const later = T0 + RENEW_GRANT_AFTER_MS + 1000;
    const fetchImpl = vi.fn(async () => reply(200, await serverGrant({ issuedAtMs: later })));

    const outcome = await ensureOfflineGrant({ userId: USER, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => later });

    expect(outcome).toBe("stored");
    expect((await getDb().session.get("current"))?.issuedAt).toBe(new Date(Math.floor(later / 1000) * 1000).toISOString());
  });

  it("aparelho compartilhado: o grant guardado é de OUTRA pessoa → pede o de quem está logada agora", async () => {
    await ensureOfflineGrant({ userId: OTHER_USER, fetchImpl: (async () => reply(200, await serverGrant({ userId: OTHER_USER }))) as unknown as typeof fetch, now: now() });
    const fetchImpl = vi.fn(async () => reply(200, await serverGrant({ userId: USER })));

    const outcome = await ensureOfflineGrant({ userId: USER, fetchImpl: fetchImpl as unknown as typeof fetch, now: now(1000) });

    expect(outcome).toBe("stored");
    expect((await getDb().session.get("current"))?.userId).toBe(USER);
  });

  it("relógio do aparelho ATRASADO em relação à emissão (idade negativa) também renova, em vez de confiar num grant 'do futuro'", async () => {
    await ensureOfflineGrant({ userId: USER, fetchImpl: (async () => reply(200, await serverGrant())) as unknown as typeof fetch, now: now() });
    const fetchImpl = vi.fn(async () => reply(200, await serverGrant()));

    const outcome = await ensureOfflineGrant({ userId: USER, fetchImpl: fetchImpl as unknown as typeof fetch, now: now(-3 * 24 * 3600 * 1000) });

    expect(outcome).toBe("stored");
  });

  it("ao guardar um grant novo, o aviso de 'aparelho revogado' sai — entrar de novo prova que o acesso voltou", async () => {
    await getDb().deviceState.put({ key: "revocation", revokedAt: "2026-09-19T10:00:00.000Z", reason: "MEMBERSHIP_REVOKED", userId: USER });

    await ensureOfflineGrant({ userId: USER, fetchImpl: (async () => reply(200, await serverGrant())) as unknown as typeof fetch, now: now() });

    expect(await getDb().deviceState.get("revocation")).toBeUndefined();
  });

  describe("quando não dá para obter, nada é guardado e o aviso NÃO sai", () => {
    beforeEach(async () => {
      await getDb().deviceState.put({ key: "revocation", revokedAt: "2026-09-19T10:00:00.000Z", reason: "MEMBERSHIP_REVOKED", userId: USER });
    });

    const cases: Array<[string, "unauthorized" | "failed", () => Promise<Response>]> = [
      ["sem sessão (401)", "unauthorized", async () => reply(401, { error: "sessão" })],
      ["sem vínculo ativo (403)", "unauthorized", async () => reply(403, { error: "sem vínculo" })],
      ["erro do servidor (500)", "failed", async () => reply(500, {})],
      ["rede fora", "failed", async () => Promise.reject(new TypeError("Failed to fetch"))],
      ["resposta sem o jwt", "failed", async () => reply(200, { serverTime: "x" })],
      ["grant assinado por OUTRA chave (a assinatura não confere)", "failed", async () => reply(200, await serverGrant({ key: (await generateKeyPair("EdDSA", { crv: "Ed25519" })).privateKey }))],
    ];

    for (const [name, expected, respond] of cases) {
      it(`${name} → ${expected}`, async () => {
        const outcome = await ensureOfflineGrant({ userId: USER, fetchImpl: vi.fn(respond) as unknown as typeof fetch, now: now() });

        expect(outcome).toBe(expected);
        expect(await getDb().session.get("current")).toBeUndefined();
        expect(await getDb().deviceState.get("revocation")).toBeDefined();
      });
    }
  });
});
