import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";
import {
  countKeptOnDeviceAll,
  describeDeviceRevoked,
  discardRevokedDeviceData,
  purgeDeviceData,
} from "@/lib/sync/device-revocation";
import { listPreparedEventIds } from "@/lib/sync/bootstrap";
import { addEvidence, grant, op, seedEvent } from "../helpers/local-fixtures";

const A = "01991b1a-0000-7000-8000-0000000000a0";
const B = "01991b1a-0000-7000-8000-0000000000b0";
const USER = "01991b1a-0000-7000-8000-000000000001";

/** Um aparelho de campo típico: dois eventos preparados, um grant e trabalho ainda não enviado. */
async function fieldDevice() {
  const db = getDb();
  await seedEvent(db, A, "a");
  await seedEvent(db, B, "b");
  await db.session.put(grant({ userId: USER }));
  return db;
}

describe("aparelho revogado — o que sai e o que fica", () => {
  beforeEach(() => resetDbInstanceForTests());
  afterEach(async () => {
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  describe("purgeDeviceData", () => {
    it("tira TUDO o que o servidor já guarda, de TODOS os eventos, e o grant", async () => {
      const db = await fieldDevice();

      await purgeDeviceData(db, { reason: "MEMBERSHIP_REVOKED", userId: USER });

      for (const table of [db.events, db.tasks, db.checklists, db.checklistItems, db.occurrences, db.conflicts, db.syncState, db.session]) {
        expect(await table.count(), table.name).toBe(0);
      }
      expect(await listPreparedEventIds(db)).toEqual([]);
    });

    it("guarda o aviso: motivo, hora e de quem eram os dados", async () => {
      const db = await fieldDevice();

      await purgeDeviceData(db, { reason: "ACCOUNT_DISABLED", userId: USER });

      expect(await db.deviceState.get("revocation")).toEqual({
        key: "revocation",
        revokedAt: expect.any(String),
        reason: "ACCOUNT_DISABLED",
        userId: USER,
      });
    });

    it("NÃO apaga o que só existe no aparelho: as alterações não enviadas (em qualquer estado) e os arquivos de evidência", async () => {
      const db = await fieldDevice();
      for (const status of ["PENDING", "SENDING", "FAILED", "CONFLICT"] as const) {
        await db.outbox.add(op(A, `op-${status}`, { status }));
      }
      await db.outbox.add(op(B, "op-do-outro-evento"));
      await addEvidence(db, A, "a", { withFile: true });
      await addEvidence(db, B, "b", { withFile: false });

      const kept = await purgeDeviceData(db, { reason: "MEMBERSHIP_REVOKED", userId: USER });

      expect(kept).toEqual({ unsentChanges: 5, localFiles: 1 });
      expect(await db.outbox.count()).toBe(5);
      expect(await db.evidenceBlobs.get("a-evidence")).toBeDefined();
      expect(await db.occurrenceEvidence.get("a-evidence")).toBeDefined();
      // O metadado de quem não tem arquivo aqui está no servidor: sai.
      expect(await db.occurrenceEvidence.get("b-evidence")).toBeUndefined();
    });

    it("põe em QUARENTENA a fila (PENDING/SENDING → FAILED): ninguém envia o que sobrou com a identidade de outra pessoa", async () => {
      // Regressão de desenho: sem sessão nem servidor no meio, a fila seguiria PENDING e a próxima
      // pessoa a abrir o app neste aparelho enviaria o trabalho de quem perdeu o vínculo.
      const db = await fieldDevice();
      await db.outbox.bulkAdd([
        op(A, "pendente"),
        op(B, "enviando", { status: "SENDING" }),
        op(A, "conflito", { status: "CONFLICT" }),
      ]);

      await purgeDeviceData(db, { reason: "MEMBERSHIP_REVOKED", userId: USER });

      const byId = Object.fromEntries((await db.outbox.toArray()).map((o) => [o.id, o]));
      expect(byId["pendente"]).toMatchObject({ status: "FAILED", lastError: "MEMBERSHIP_REVOKED" });
      expect(byId["enviando"]).toMatchObject({ status: "FAILED", lastError: "MEMBERSHIP_REVOKED" });
      expect(byId["conflito"]).toMatchObject({ status: "CONFLICT" });
      expect(byId["pendente"]?.payload).toEqual({ title: "Pendente pendente" });
      expect(await db.outbox.where("status").equals("PENDING").count()).toBe(0);
    });

    it("`onlyIfGrant`: se a pessoa entrou de novo enquanto perguntávamos (grant novo), o veredito é velho e NADA é apagado", async () => {
      // Sem esta trava, quem acabou de recuperar o vínculo perderia os dados que baixou agora.
      const db = await fieldDevice();
      await db.outbox.add(op(A, "a"));
      await db.session.put(grant({ userId: USER, jwt: "grant-NOVO" }));

      const result = await purgeDeviceData(db, { reason: "MEMBERSHIP_REVOKED", userId: USER, onlyIfGrant: "jwt-do-grant" });

      expect(result).toBeNull();
      expect(await db.tasks.count()).toBe(2);
      expect((await db.session.get("current"))?.jwt).toBe("grant-NOVO");
      expect(await db.deviceState.get("revocation")).toBeUndefined();
      expect((await db.outbox.get("a"))?.status).toBe("PENDING");
    });

    it("`onlyIfGrant` igual ao guardado: limpa", async () => {
      const db = await fieldDevice();

      const result = await purgeDeviceData(db, { reason: null, userId: USER, onlyIfGrant: "jwt-do-grant" });

      expect(result).not.toBeNull();
      expect(await db.tasks.count()).toBe(0);
    });

    it("é tudo-ou-nada: se gravar o aviso falha, nada foi apagado (nem o grant)", async () => {
      const db = await fieldDevice();
      await db.outbox.add(op(A, "a"));
      vi.spyOn(db.deviceState, "put").mockRejectedValueOnce(new Error("falha injetada"));

      await expect(purgeDeviceData(db, { reason: "MEMBERSHIP_REVOKED", userId: USER })).rejects.toThrow("falha injetada");

      expect(await db.tasks.count()).toBe(2);
      expect(await db.events.count()).toBe(2);
      expect(await db.session.get("current")).toBeDefined();
      expect((await db.outbox.get("a"))?.status).toBe("PENDING"); // a quarentena também desfez
    });

    it("rodar de novo é inofensivo e mantém o que ficou", async () => {
      const db = await fieldDevice();
      await db.outbox.add(op(A, "a"));
      await purgeDeviceData(db, { reason: "MEMBERSHIP_REVOKED", userId: USER });

      const again = await purgeDeviceData(db, { reason: "MEMBERSHIP_REVOKED", userId: USER });

      expect(again).toEqual({ unsentChanges: 1, localFiles: 0 });
    });
  });

  describe("discardRevokedDeviceData", () => {
    it("esvazia TUDO — o que ficou e o aviso —, com o banco aberto", async () => {
      const db = await fieldDevice();
      await db.outbox.add(op(A, "a"));
      await addEvidence(db, A, "a", { withFile: true });
      await purgeDeviceData(db, { reason: "MEMBERSHIP_REVOKED", userId: USER });

      await discardRevokedDeviceData(db);

      for (const table of db.tables) expect(await table.count(), table.name).toBe(0);
      expect(db.isOpen()).toBe(true);
    });

    it("RECUSA um aparelho que não foi revogado: esvaziar o banco de um aparelho saudável perderia trabalho por engano", async () => {
      const db = await fieldDevice();
      await db.outbox.add(op(A, "ainda-vai-ser-enviada"));

      await expect(discardRevokedDeviceData(db)).rejects.toThrow(/não foi revogado/);

      expect(await db.outbox.count()).toBe(1);
      expect(await db.tasks.count()).toBe(2);
      expect(await db.session.get("current")).toBeDefined();
    });
  });

  describe("countKeptOnDeviceAll / describeDeviceRevoked", () => {
    it("conta a outbox e os arquivos de TODOS os eventos", async () => {
      const db = await fieldDevice();
      await db.outbox.bulkAdd([op(A, "a"), op(B, "b")]);
      await addEvidence(db, A, "a", { withFile: true });
      await addEvidence(db, B, "b", { withFile: true });

      expect(await countKeptOnDeviceAll(db)).toEqual({ unsentChanges: 2, localFiles: 2 });
    });

    it("traduz cada motivo numa frase, nunca o código cru", () => {
      expect(describeDeviceRevoked("MEMBERSHIP_REVOKED")).toBe("Seu vínculo com a empresa foi encerrado.");
      expect(describeDeviceRevoked("ACCOUNT_DISABLED")).toBe("A sua conta foi desativada.");
      expect(describeDeviceRevoked("DEVICE_REVOKED")).toBe("O acesso deste aparelho foi encerrado.");
      for (const reason of [undefined, null, "", "MOTIVO_NOVO"]) {
        const text = describeDeviceRevoked(reason);
        expect(text).toBe("Este aparelho perdeu o acesso à empresa.");
        expect(text).not.toMatch(/_/);
      }
    });
  });
});
