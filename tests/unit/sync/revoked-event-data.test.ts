import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDbInstanceForTests, type OutboxOperation } from "@/lib/db/dexie/db";
import { listPreparedEventIds } from "@/lib/sync/bootstrap";
import { countKeptOnDevice, discardRevokedEventData, purgeRevokedEventData } from "@/lib/sync/access";
import { decryptPendingExport, exportPendingChangesEncrypted } from "@/lib/sync/export-pending";
import { NOTHING_LEFT, addEvidence, op, rowsOf, seedEvent } from "../helpers/local-fixtures";

const REVOKED = "01991b1a-0000-7000-8000-0000000000a0";
const OTHER = "01991b1a-0000-7000-8000-0000000000b0";

describe("evento cujo acesso foi retirado — o que sai e o que fica no aparelho", () => {
  beforeEach(() => resetDbInstanceForTests());
  afterEach(async () => {
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  describe("purgeRevokedEventData", () => {
    it("tira do aparelho tudo o que o servidor já guarda: evento, tarefas, checklists, itens, ocorrências e conflitos", async () => {
      const db = getDb();
      await seedEvent(db, REVOKED, "r");

      await purgeRevokedEventData(db, REVOKED, "EVENT_ACCESS_REVOKED");

      expect(await rowsOf(db, REVOKED, "r")).toEqual(NOTHING_LEFT);
    });

    it("deixa o evento fora dos 'preparados' e guarda o aviso, o motivo e a hora — sem o cursor antigo", async () => {
      const db = getDb();
      await seedEvent(db, REVOKED, "r");

      await purgeRevokedEventData(db, REVOKED, "MEMBERSHIP_REVOKED");

      expect(await listPreparedEventIds(db)).not.toContain(REVOKED);
      expect(await db.syncState.get(REVOKED)).toMatchObject({
        key: REVOKED,
        cursor: null,
        lastFullBootstrapAt: null,
        expectedCounts: null,
        accessRevokedReason: "MEMBERSHIP_REVOKED",
        accessRevokedAt: expect.any(String),
      });
    });

    it("NÃO apaga as alterações ainda não enviadas (a outbox do evento), em nenhum estado", async () => {
      // O que só existe aqui: apagar em silêncio destruiria trabalho de campo.
      const db = getDb();
      await seedEvent(db, REVOKED, "r");
      for (const status of ["PENDING", "SENDING", "FAILED", "CONFLICT"] as const) {
        await db.outbox.add(op(REVOKED, `op-${status}`, { status }));
      }

      const kept = await purgeRevokedEventData(db, REVOKED, "EVENT_ACCESS_REVOKED");

      expect(kept).toEqual({ unsentChanges: 4, localFiles: 0 });
      expect((await db.outbox.where("eventId").equals(REVOKED).toArray()).map((o) => o.payload)).toHaveLength(4);
    });

    it("põe em QUARENTENA o que ainda estava na fila: PENDING/SENDING viram FAILED (com o motivo), o resto fica como estava", async () => {
      // Regressão de desenho: a outbox não tem dono. Se a operação seguisse PENDING, a próxima
      // sessão que abrisse neste aparelho — de OUTRA pessoa — a enviaria com a identidade dela.
      const db = getDb();
      await seedEvent(db, REVOKED, "r");
      for (const status of ["PENDING", "SENDING", "FAILED", "CONFLICT"] as const) {
        await db.outbox.add(op(REVOKED, `op-${status}`, { status, lastError: status === "FAILED" ? "erro antigo" : null }));
      }

      await purgeRevokedEventData(db, REVOKED, "EVENT_ACCESS_REVOKED");

      const byId = Object.fromEntries((await db.outbox.toArray()).map((o) => [o.id, o]));
      expect(byId["op-PENDING"]).toMatchObject({ status: "FAILED", lastError: "EVENT_ACCESS_REVOKED" });
      expect(byId["op-SENDING"]).toMatchObject({ status: "FAILED", lastError: "EVENT_ACCESS_REVOKED" });
      expect(byId["op-FAILED"]).toMatchObject({ status: "FAILED", lastError: "erro antigo" });
      expect(byId["op-CONFLICT"]).toMatchObject({ status: "CONFLICT" });
      // E nada além do estado mudou: o conteúdo é da pessoa e continua exportável.
      expect(byId["op-PENDING"]?.payload).toEqual({ title: "Pendente op-PENDING" });
    });

    it("a quarentena é só deste evento: a fila de outro evento continua PENDING", async () => {
      const db = getDb();
      await seedEvent(db, REVOKED, "r");
      await seedEvent(db, OTHER, "o");
      await db.outbox.bulkAdd([op(REVOKED, "a"), op(OTHER, "b")]);

      await purgeRevokedEventData(db, REVOKED, "EVENT_ACCESS_REVOKED");

      expect((await db.outbox.get("b"))?.status).toBe("PENDING");
    });

    it("NÃO apaga o arquivo da evidência (o binário só existe aqui) nem o registro dele; apaga o metadado de quem não tem arquivo", async () => {
      // Regressão de desenho: o binário nunca sobe ao servidor; apagá-lo destruiria evidência da empresa.
      const db = getDb();
      await seedEvent(db, REVOKED, "r");
      await addEvidence(db, REVOKED, "r", { withFile: true });
      await addEvidence(db, REVOKED, "r", { withFile: false, suffix: "-sem-arquivo" });

      const kept = await purgeRevokedEventData(db, REVOKED, "EVENT_ACCESS_REVOKED");

      expect(kept.localFiles).toBe(1);
      expect(await db.evidenceBlobs.get("r-evidence")).toBeDefined();
      expect(await db.occurrenceEvidence.get("r-evidence")).toBeDefined();
      expect(await db.occurrenceEvidence.get("r-evidence-sem-arquivo")).toBeUndefined();
    });

    it("mexe SÓ nesse evento: dados, outbox e registro de sincronização de outro evento ficam intactos", async () => {
      const db = getDb();
      await seedEvent(db, REVOKED, "r");
      await seedEvent(db, OTHER, "o");
      await addEvidence(db, OTHER, "o", { withFile: true });
      await db.outbox.add(op(OTHER, "op-other"));
      const before = await rowsOf(db, OTHER, "o");
      const stateBefore = await db.syncState.get(OTHER);

      await purgeRevokedEventData(db, REVOKED, "EVENT_ACCESS_REVOKED");

      expect(await rowsOf(db, OTHER, "o")).toEqual(before);
      expect(before).toMatchObject({ event: 1, tasks: 1, checklists: 1, items: 1, occurrences: 1, evidence: 1, blobs: 1, conflicts: 1, outbox: 1 });
      expect(await db.syncState.get(OTHER)).toEqual(stateBefore);
      expect(await listPreparedEventIds(db)).toEqual([OTHER]);
    });

    it("evento que o aparelho não conhece: não cria registro fantasma e não devolve nada", async () => {
      const db = getDb();

      expect(await purgeRevokedEventData(db, "evento-desconhecido", "EVENT_ACCESS_REVOKED")).toEqual({ unsentChanges: 0, localFiles: 0 });
      expect(await db.syncState.get("evento-desconhecido")).toBeUndefined();
    });

    it("é tudo-ou-nada: se a gravação do aviso falha, nada foi apagado", async () => {
      // Sem a transação, uma falha no meio deixaria o evento sem dados e sem aviso do porquê.
      const db = getDb();
      await seedEvent(db, REVOKED, "r");
      const before = await rowsOf(db, REVOKED, "r");
      vi.spyOn(db.syncState, "put").mockRejectedValueOnce(new Error("falha injetada"));

      await expect(purgeRevokedEventData(db, REVOKED, "EVENT_ACCESS_REVOKED")).rejects.toThrow("falha injetada");

      expect(await rowsOf(db, REVOKED, "r")).toEqual(before);
      expect((await db.syncState.get(REVOKED))?.lastFullBootstrapAt).toBe("2026-09-19T10:00:00.000Z");
    });

    it("rodar de novo (outro ciclo, outra aba) é inofensivo e mantém o que ficou", async () => {
      const db = getDb();
      await seedEvent(db, REVOKED, "r");
      await db.outbox.add(op(REVOKED, "op-1"));
      await purgeRevokedEventData(db, REVOKED, "EVENT_ACCESS_REVOKED");

      const again = await purgeRevokedEventData(db, REVOKED, "EVENT_ACCESS_REVOKED");

      expect(again.unsentChanges).toBe(1);
      expect(await db.outbox.count()).toBe(1);
    });
  });

  describe("countKeptOnDevice", () => {
    it("conta alterações não enviadas e arquivos, só do evento pedido", async () => {
      const db = getDb();
      await seedEvent(db, REVOKED, "r");
      await seedEvent(db, OTHER, "o");
      await addEvidence(db, REVOKED, "r", { withFile: true });
      await addEvidence(db, OTHER, "o", { withFile: true });
      await db.outbox.bulkAdd([op(REVOKED, "a"), op(REVOKED, "b"), op(OTHER, "c")]);

      expect(await countKeptOnDevice(db, REVOKED)).toEqual({ unsentChanges: 2, localFiles: 1 });
      expect(await countKeptOnDevice(db, "nada")).toEqual({ unsentChanges: 0, localFiles: 0 });
    });
  });

  describe("discardRevokedEventData", () => {
    it("remove o que ficou — alterações, arquivos, registros e o aviso —, e só desse evento", async () => {
      const db = getDb();
      await seedEvent(db, REVOKED, "r");
      await seedEvent(db, OTHER, "o");
      await addEvidence(db, REVOKED, "r", { withFile: true });
      await db.outbox.bulkAdd([op(REVOKED, "a"), op(OTHER, "b")]);
      await purgeRevokedEventData(db, REVOKED, "EVENT_ACCESS_REVOKED");
      const otherBefore = await rowsOf(db, OTHER, "o");

      await discardRevokedEventData(db, REVOKED);

      expect(await rowsOf(db, REVOKED, "r")).toEqual(NOTHING_LEFT);
      expect(await db.syncState.get(REVOKED)).toBeUndefined();
      expect(await rowsOf(db, OTHER, "o")).toEqual(otherBefore);
    });

    it("RECUSA um evento cujo acesso não foi retirado: a outbox de um evento saudável não pode ser descartada por engano", async () => {
      const db = getDb();
      await seedEvent(db, OTHER, "o");
      await db.outbox.add(op(OTHER, "ainda-vai-ser-enviada"));

      await expect(discardRevokedEventData(db, OTHER)).rejects.toThrow(/não foi retirado/);

      expect(await db.outbox.count()).toBe(1);
      expect(await db.tasks.count()).toBe(1);
      expect(await db.syncState.get(OTHER)).toBeDefined();
    });

    it("recusa evento que o aparelho nem conhece", async () => {
      await expect(discardRevokedEventData(getDb(), "evento-desconhecido")).rejects.toThrow(/não foi retirado/);
    });
  });

  describe("exportar só as alterações do evento", () => {
    it("com eventId, o arquivo leva só as pendências daquele evento", async () => {
      const db = getDb();
      await db.outbox.bulkAdd([op(REVOKED, "a"), op(REVOKED, "b"), op(OTHER, "c")]);

      const exported = await exportPendingChangesEncrypted(db, "senha-forte-123", { eventId: REVOKED });
      const data = await decryptPendingExport(exported, "senha-forte-123");

      expect((data.outbox as OutboxOperation[]).map((o) => o.id).sort()).toEqual(["a", "b"]);
    });

    it("sem eventId continua exportando tudo (o logout)", async () => {
      const db = getDb();
      await db.outbox.bulkAdd([op(REVOKED, "a"), op(OTHER, "c")]);

      const data = await decryptPendingExport(await exportPendingChangesEncrypted(db, "senha-forte-123"), "senha-forte-123");

      expect(data.outbox).toHaveLength(2);
    });
  });
});
