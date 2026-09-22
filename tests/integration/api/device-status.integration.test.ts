/**
 * Canal SEM sessão para o aparelho descobrir que perdeu o acesso (integração — Postgres real, ver
 * cabeçalho de sync-push.integration.test.ts).
 *
 * Quem teve o vínculo encerrado perde a sessão e não consegue mais entrar; o único que o aparelho
 * tem é o grant offline. O que importa aqui: o veredito sai do BANCO agora, "revogado" só sai para
 * grant AUTÊNTICO (nunca por um grant forjado, vencido-mas-autêntico é julgado normalmente), e um
 * id de dispositivo alheio nunca faz uma pessoa ser julgada revogada.
 */
import { randomUUID } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/auth/device-status/route";
import {
  createMembership,
  createTestCompany,
  createTestPrismaClient,
  createTestUser,
  truncateAll,
} from "../helpers/factories";
import { issueOfflineGrant } from "@/server/auth/offline-grant.service";
import { evaluateDeviceGrant, InvalidGrantError } from "@/server/auth/device-status.service";
import { createEvent } from "@/server/events/event.service";
import { changeMember, resetMemberPassword } from "@/server/team/team.service";

const prisma = createTestPrismaClient();

/** A chave PRIVADA com que o "servidor" deste teste assina — a mesma que o serviço lê do ambiente. */
let realKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

describe("canal do aparelho sem sessão — device-status (integração — Postgres real)", () => {
  beforeAll(async () => {
    const pair = await generateKeyPair("EdDSA", { extractable: true });
    realKey = pair.privateKey;
    vi.stubEnv("OFFLINE_GRANT_PRIVATE_KEY_JWK", JSON.stringify(await exportJWK(pair.privateKey)));
  });
  beforeEach(async () => {
    await truncateAll(prisma);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  async function setup() {
    const company = await createTestCompany(prisma);
    const owner = await createTestUser(prisma, `titular-${company.id}@x.com`);
    await createMembership(prisma, owner.id, company.id, "OWNER");
    return { company, owner };
  }

  async function person(companyId: string, role: "STAFF" | "PRODUCER" = "STAFF") {
    const user = await createTestUser(prisma);
    const membership = await createMembership(prisma, user.id, companyId, role);
    return { user, membership };
  }

  /** Um aparelho da pessoa com o grant REAL emitido pelo serviço (cria a linha de `Device`). */
  async function deviceOf(userId: string, companyId: string) {
    const deviceId = randomUUID();
    const grant = await issueOfflineGrant({ userId, companyId, deviceId });
    return { deviceId, jwt: grant.jwt };
  }

  describe("evaluateDeviceGrant", () => {
    it("pessoa ativa, vínculo ativo, aparelho não revogado: valid", async () => {
      const { company } = await setup();
      const staff = await person(company.id);
      const device = await deviceOf(staff.user.id, company.id);

      expect(await evaluateDeviceGrant(device.jwt)).toEqual({ status: "valid" });
    });

    it("vínculo encerrado pela administração: revoked — e os aparelhos DELA nesta empresa são marcados, só eles", async () => {
      const { company, owner } = await setup();
      const leaving = await person(company.id);
      const phone = await deviceOf(leaving.user.id, company.id);
      const tablet = await deviceOf(leaving.user.id, company.id);
      const stayingPerson = await person(company.id);
      const stayingDevice = await deviceOf(stayingPerson.user.id, company.id);
      const otherCompany = await createTestCompany(prisma);
      await createMembership(prisma, leaving.user.id, otherCompany.id, "STAFF");
      const inOtherCompany = await deviceOf(leaving.user.id, otherCompany.id);

      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: leaving.membership.id, status: "REVOKED" });

      expect(await evaluateDeviceGrant(phone.jwt)).toEqual({ status: "revoked", reason: "MEMBERSHIP_REVOKED" });
      expect(await evaluateDeviceGrant(tablet.jwt)).toEqual({ status: "revoked", reason: "MEMBERSHIP_REVOKED" });
      const marked = await prisma.device.findMany({ where: { revokedAt: { not: null } }, select: { id: true } });
      expect(marked.map((d) => d.id).sort()).toEqual([phone.deviceId, tablet.deviceId].sort());
      // Outra pessoa e a MESMA pessoa em outra empresa não são tocadas.
      expect(await evaluateDeviceGrant(stayingDevice.jwt)).toEqual({ status: "valid" });
      expect(await evaluateDeviceGrant(inOtherCompany.jwt)).toEqual({ status: "valid" });
    });

    it("o histórico do vínculo encerrado diz quantos aparelhos foram revogados", async () => {
      const { company, owner } = await setup();
      const leaving = await person(company.id);
      await deviceOf(leaving.user.id, company.id);
      await deviceOf(leaving.user.id, company.id);

      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: leaving.membership.id, status: "REVOKED" });

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "MEMBER_REVOKED" } });
      expect(audit.metadata).toMatchObject({ devicesRevoked: 2 });
    });

    it("é julgado pelo BANCO agora: vínculo revogado direto no banco (sem passar pela tela) também vale", async () => {
      const { company } = await setup();
      const staff = await person(company.id);
      const device = await deviceOf(staff.user.id, company.id);
      await prisma.membership.updateMany({ where: { userId: staff.user.id }, data: { status: "REVOKED", revokedAt: new Date() } });

      expect(await evaluateDeviceGrant(device.jwt)).toEqual({ status: "revoked", reason: "MEMBERSHIP_REVOKED" });
    });

    it("conta desativada: revoked ACCOUNT_DISABLED (a conta vence o vínculo)", async () => {
      const { company } = await setup();
      const staff = await person(company.id);
      const device = await deviceOf(staff.user.id, company.id);
      await prisma.user.update({ where: { id: staff.user.id }, data: { isActive: false } });

      expect(await evaluateDeviceGrant(device.jwt)).toEqual({ status: "revoked", reason: "ACCOUNT_DISABLED" });
    });

    it("aparelho revogado explicitamente: revoked DEVICE_REVOKED, mesmo com vínculo ativo", async () => {
      const { company } = await setup();
      const staff = await person(company.id);
      const device = await deviceOf(staff.user.id, company.id);
      await prisma.device.update({ where: { id: device.deviceId }, data: { revokedAt: new Date() } });

      expect(await evaluateDeviceGrant(device.jwt)).toEqual({ status: "revoked", reason: "DEVICE_REVOKED" });
    });

    it("reativar o vínculo NÃO devolve o aparelho: o grant velho segue revogado, e um login novo (grant novo) o devolve", async () => {
      // O mesmo princípio do acesso ao evento: o que foi cortado não volta sozinho ao reativar.
      const { company, owner } = await setup();
      const staff = await person(company.id);
      const device = await deviceOf(staff.user.id, company.id);
      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id, status: "REVOKED" });
      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id, status: "ACTIVE" });

      expect(await evaluateDeviceGrant(device.jwt)).toEqual({ status: "revoked", reason: "DEVICE_REVOKED" });

      const renewed = await issueOfflineGrant({ userId: staff.user.id, companyId: company.id, deviceId: device.deviceId });
      expect(await evaluateDeviceGrant(renewed.jwt)).toEqual({ status: "valid" });
    });

    it("grant VENCIDO mas autêntico é julgado normalmente — o aparelho parado há dias é quem mais precisa saber", async () => {
      const { company, owner } = await setup();
      const staff = await person(company.id);
      const expiredJwt = await new SignJWT({ companyId: company.id, deviceId: randomUUID() })
        .setProtectedHeader({ alg: "EdDSA" })
        .setSubject(staff.user.id)
        .setIssuedAt(new Date(Date.now() - 10 * 24 * 3600 * 1000))
        .setExpirationTime(new Date(Date.now() - 24 * 3600 * 1000))
        .sign(realKey);

      expect(await evaluateDeviceGrant(expiredJwt)).toEqual({ status: "valid" });
      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id, status: "REVOKED" });
      expect(await evaluateDeviceGrant(expiredJwt)).toEqual({ status: "revoked", reason: "MEMBERSHIP_REVOKED" });
    });

    it("um id de dispositivo ALHEIO nunca faz a pessoa ser julgada revogada", async () => {
      // O id vem do cliente. Se valesse a linha de qualquer dono, revogar o aparelho de um seria
      // um jeito de "revogar" o de outro.
      const { company } = await setup();
      const a = await person(company.id);
      const b = await person(company.id);
      const bDevice = await deviceOf(b.user.id, company.id);
      await prisma.device.update({ where: { id: bDevice.deviceId }, data: { revokedAt: new Date() } });
      const aWithBsDeviceId = await new SignJWT({ companyId: company.id, deviceId: bDevice.deviceId })
        .setProtectedHeader({ alg: "EdDSA" })
        .setSubject(a.user.id)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(realKey);

      expect(await evaluateDeviceGrant(aWithBsDeviceId)).toEqual({ status: "valid" });
    });

    describe("grant que não é autêntico NUNCA vira veredito (o cliente só apaga por veredito)", () => {
      it("assinado com outra chave", async () => {
        const { company } = await setup();
        const staff = await person(company.id);
        const stranger = await generateKeyPair("EdDSA");
        const forged = await new SignJWT({ companyId: company.id, deviceId: randomUUID() })
          .setProtectedHeader({ alg: "EdDSA" })
          .setSubject(staff.user.id)
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(stranger.privateKey);

        await expect(evaluateDeviceGrant(forged)).rejects.toBeInstanceOf(InvalidGrantError);
      });

      it("algoritmo trocado (HS256 com a chave pública como segredo — o ataque clássico de confusão)", async () => {
        const { company } = await setup();
        const staff = await person(company.id);
        const publicX = (JSON.parse(process.env.OFFLINE_GRANT_PRIVATE_KEY_JWK!) as { x: string }).x;
        const hs = await new SignJWT({ companyId: company.id, deviceId: randomUUID() })
          .setProtectedHeader({ alg: "HS256" })
          .setSubject(staff.user.id)
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(new TextEncoder().encode(publicX));

        await expect(evaluateDeviceGrant(hs)).rejects.toBeInstanceOf(InvalidGrantError);
      });

      it("lixo, vazio e assinatura autêntica com claims que faltam", async () => {
        const noSub = await new SignJWT({ companyId: randomUUID(), deviceId: randomUUID() })
          .setProtectedHeader({ alg: "EdDSA" })
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(realKey);
        const badSub = await new SignJWT({ companyId: randomUUID(), deviceId: randomUUID() })
          .setProtectedHeader({ alg: "EdDSA" })
          .setSubject("nao-e-uuid")
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(realKey);

        for (const jwt of ["", "lixo", "a.b.c", noSub, badSub]) {
          await expect(evaluateDeviceGrant(jwt), jwt.slice(0, 20)).rejects.toBeInstanceOf(InvalidGrantError);
        }
      });
    });
  });

  describe("o que NÃO revoga aparelho", () => {
    it("redefinir a senha (a sessão cai, mas os dados do aparelho seguem valendo: a pessoa continua da empresa)", async () => {
      const { company, owner } = await setup();
      const staff = await person(company.id);
      const device = await deviceOf(staff.user.id, company.id);

      await resetMemberPassword({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id });

      expect(await evaluateDeviceGrant(device.jwt)).toEqual({ status: "valid" });
    });

    it("mudar só o papel", async () => {
      const { company, owner } = await setup();
      const staff = await person(company.id);
      const device = await deviceOf(staff.user.id, company.id);

      await changeMember({ actorId: owner.id, companyId: company.id, membershipId: staff.membership.id, role: "PRODUCER" });

      expect(await evaluateDeviceGrant(device.jwt)).toEqual({ status: "valid" });
    });

    it("um encerramento RECUSADO (único gestor de um evento): a transação inteira desfaz, o aparelho segue valendo", async () => {
      const { company, owner } = await setup();
      const producer = await person(company.id, "PRODUCER");
      await createEvent({
        userId: producer.user.id,
        companyId: company.id,
        input: { name: "Festival", startDate: "2026-12-01T12:00:00.000Z", endDate: "2026-12-02T12:00:00.000Z", status: "PLANNED" },
      });
      const device = await deviceOf(producer.user.id, company.id);

      await expect(
        changeMember({ actorId: owner.id, companyId: company.id, membershipId: producer.membership.id, status: "REVOKED" })
      ).rejects.toMatchObject({ name: "AdminActionError", status: 409 });

      expect(await evaluateDeviceGrant(device.jwt)).toEqual({ status: "valid" });
      expect((await prisma.device.findUniqueOrThrow({ where: { id: device.deviceId } })).revokedAt).toBeNull();
    });
  });

  describe("POST /api/auth/device-status (rota pública)", () => {
    const call = (body: unknown) =>
      POST(new Request("http://localhost/api/auth/device-status", { method: "POST", body: JSON.stringify(body) }));

    it("responde o veredito SEM sessão, e nunca guarda em cache", async () => {
      const { company } = await setup();
      const staff = await person(company.id);
      const device = await deviceOf(staff.user.id, company.id);

      const res = await call({ jwt: device.jwt });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "valid" });
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("revogado: 200 com o motivo (o veredito não é um erro)", async () => {
      const { company } = await setup();
      const staff = await person(company.id);
      const device = await deviceOf(staff.user.id, company.id);
      await prisma.membership.updateMany({ where: { userId: staff.user.id }, data: { status: "REVOKED" } });

      const res = await call({ jwt: device.jwt });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "revoked", reason: "MEMBERSHIP_REVOKED" });
    });

    it("grant inautêntico: 401 'invalid' (o cliente lê como 'não sei' e não apaga nada); corpo ruim: 400", async () => {
      const bad = await call({ jwt: "lixo" });
      expect(bad.status).toBe(401);
      expect(await bad.json()).toEqual({ status: "invalid" });

      for (const body of [null, {}, { jwt: "" }, { jwt: 42 }, { jwt: "x".repeat(5000) }]) {
        const res = await call(body);
        expect(res.status, JSON.stringify(body)?.slice(0, 30)).toBe(400);
      }
    });

    it("bloqueia requisições inválidas repetidas do mesmo IP para evitar força bruta no grant", async () => {
      const headers = new Headers({ "x-forwarded-for": "203.0.113.77" });

      for (let i = 0; i < 5; i += 1) {
        const res = await POST(
          new Request("http://localhost/api/auth/device-status", {
            method: "POST",
            headers,
            body: JSON.stringify({ jwt: "lixo" }),
          })
        );
        expect(res.status).toBe(401);
      }

      const blocked = await POST(
        new Request("http://localhost/api/auth/device-status", {
          method: "POST",
          headers,
          body: JSON.stringify({ jwt: "lixo" }),
        })
      );

      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toEqual({ status: "rate_limited" });
    });
  });
});
