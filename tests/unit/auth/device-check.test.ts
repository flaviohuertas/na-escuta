import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkDeviceStatus } from "@/lib/auth/device-check";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";
import { OFFLINE_PAGES_CACHE_NAME, PRECACHE_NAME_PREFIX } from "@/lib/offline/routes";
import { grant, op, seedEvent } from "../helpers/local-fixtures";
import { installFakeCaches } from "../helpers/fake-caches";

const A = "01991b1a-0000-7000-8000-0000000000a0";
const USER = "01991b1a-0000-7000-8000-000000000001";

function reply(status: number, body: unknown, opts: { rawText?: string } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (opts.rawText !== undefined) throw new SyntaxError("Unexpected token < in JSON");
      return body;
    },
  } as Response;
}

async function fieldDevice() {
  const db = getDb();
  await seedEvent(db, A, "a");
  await db.session.put(grant({ userId: USER }));
  await db.outbox.add(op(A, "trabalho-de-campo"));
  return db;
}

/** O aparelho continua como estava: nada apagado, grant guardado, sem aviso. */
async function expectUntouched() {
  const db = getDb();
  expect(await db.tasks.count()).toBe(1);
  expect(await db.events.count()).toBe(1);
  expect(await db.syncState.count()).toBe(1);
  expect((await db.session.get("current"))?.jwt).toBe("jwt-do-grant");
  expect(await db.deviceState.get("revocation")).toBeUndefined();
  expect((await db.outbox.get("trabalho-de-campo"))?.status).toBe("PENDING");
}

describe("checkDeviceStatus — o aparelho pergunta, sem sessão, se ainda vale", () => {
  beforeEach(() => resetDbInstanceForTests());
  afterEach(async () => {
    vi.unstubAllGlobals();
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  it("sem grant guardado não há o que perguntar (e não bate no servidor)", async () => {
    const fetchImpl = vi.fn();

    expect(await checkDeviceStatus(getDb(), { fetchImpl: fetchImpl as unknown as typeof fetch })).toBe("no-grant");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("apresenta o grant ao servidor, em POST, sem cache", async () => {
    const db = await fieldDevice();
    const fetchImpl = vi.fn(async () => reply(200, { status: "valid" }));

    await checkDeviceStatus(db, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/device-status");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(String(init.body))).toEqual({ jwt: "jwt-do-grant" });
  });

  it("valid: não mexe em nada", async () => {
    const db = await fieldDevice();

    const outcome = await checkDeviceStatus(db, { fetchImpl: (async () => reply(200, { status: "valid" })) as unknown as typeof fetch });

    expect(outcome).toBe("valid");
    await expectUntouched();
  });

  describe("revoked: o aparelho se limpa", () => {
    it("tira o que o servidor guarda, apaga o grant, guarda o aviso com o motivo e de quem eram os dados", async () => {
      const db = await fieldDevice();
      const fetchImpl = (async () => reply(200, { status: "revoked", reason: "MEMBERSHIP_REVOKED" })) as unknown as typeof fetch;

      const outcome = await checkDeviceStatus(db, { fetchImpl });

      expect(outcome).toBe("revoked");
      expect(await db.tasks.count()).toBe(0);
      expect(await db.events.count()).toBe(0);
      expect(await db.session.get("current")).toBeUndefined();
      expect(await db.deviceState.get("revocation")).toMatchObject({ reason: "MEMBERSHIP_REVOKED", userId: USER });
    });

    it("mas guarda o que só existe no aparelho — em quarentena", async () => {
      const db = await fieldDevice();

      await checkDeviceStatus(db, { fetchImpl: (async () => reply(200, { status: "revoked", reason: "DEVICE_REVOKED" })) as unknown as typeof fetch });

      expect(await db.outbox.get("trabalho-de-campo")).toMatchObject({ status: "FAILED", payload: { title: "Pendente trabalho-de-campo" } });
    });

    it("apaga o HTML guardado pelo Service Worker (nome e dados dos eventos), mas não o pré-cache do build", async () => {
      const store = installFakeCaches({
        [OFFLINE_PAGES_CACHE_NAME]: [`/eventos/${A}`],
        [`${PRECACHE_NAME_PREFIX}-v2`]: ["/_next/static/app.js"],
      });
      const db = await fieldDevice();

      await checkDeviceStatus(db, { fetchImpl: (async () => reply(200, { status: "revoked", reason: "MEMBERSHIP_REVOKED" })) as unknown as typeof fetch });

      expect([...store.keys()]).toEqual([`${PRECACHE_NAME_PREFIX}-v2`]);
    });

    it("sem motivo na resposta, limpa do mesmo jeito (o aviso usa a frase genérica)", async () => {
      const db = await fieldDevice();

      const outcome = await checkDeviceStatus(db, { fetchImpl: (async () => reply(200, { status: "revoked" })) as unknown as typeof fetch });

      expect(outcome).toBe("revoked");
      expect((await db.deviceState.get("revocation"))?.reason).toBeNull();
    });

    it("veredito VELHO: se a pessoa entrou de novo enquanto perguntávamos, não apaga nada", async () => {
      // O grant guardado mudou entre a pergunta e a resposta: quem recuperou o vínculo acabou de
      // baixar dados novos, e o "revogado" que chegou é do grant de antes.
      const db = await fieldDevice();
      const fetchImpl = vi.fn(async () => {
        await db.session.put(grant({ userId: USER, jwt: "grant-NOVO" }));
        return reply(200, { status: "revoked", reason: "MEMBERSHIP_REVOKED" });
      }) as unknown as typeof fetch;

      const outcome = await checkDeviceStatus(db, { fetchImpl });

      expect(outcome).toBe("unknown");
      expect(await db.tasks.count()).toBe(1);
      expect((await db.session.get("current"))?.jwt).toBe("grant-NOVO");
      expect(await db.deviceState.get("revocation")).toBeUndefined();
    });
  });

  describe("QUALQUER outra coisa é 'não sei' e NÃO apaga nada — só um veredito do servidor apaga", () => {
    const cases: Array<[string, () => Promise<Response>]> = [
      ["falha de rede (fetch rejeita)", async () => Promise.reject(new TypeError("Failed to fetch"))],
      ["servidor com erro (500)", async () => reply(500, { error: "boom" })],
      ["servidor fora (503)", async () => reply(503, {})],
      ["grant que o servidor não reconhece (401 invalid)", async () => reply(401, { status: "invalid" })],
      ["corpo inválido (400)", async () => reply(400, { status: "invalid" })],
      ["200 com um 'invalid' (não é um veredito)", async () => reply(200, { status: "invalid" })],
      ["200 com HTML de portal cativo (JSON quebrado)", async () => reply(200, null, { rawText: "<html>Entre no Wi-Fi</html>" })],
      ["200 com corpo vazio", async () => reply(200, null)],
      ["200 com status desconhecido", async () => reply(200, { status: "quem-sabe" })],
      ["200 com um array", async () => reply(200, [{ status: "revoked" }])],
    ];

    for (const [name, respond] of cases) {
      it(name, async () => {
        const db = await fieldDevice();

        const outcome = await checkDeviceStatus(db, { fetchImpl: vi.fn(respond) as unknown as typeof fetch });

        expect(outcome).toBe("unknown");
        await expectUntouched();
      });
    }
  });
});
