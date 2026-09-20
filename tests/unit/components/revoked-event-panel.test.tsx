import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RevokedEventPanel } from "@/components/events/RevokedEventPanel";
import { getDb, resetDbInstanceForTests, type OutboxOperation } from "@/lib/db/dexie/db";
import { downloadEncryptedExport } from "@/lib/sync/export-download";
import { decryptPendingExport, type EncryptedExport } from "@/lib/sync/export-pending";
import { navigateToDocument } from "@/lib/offline/navigate";

vi.mock("@/lib/offline/navigate", () => ({ navigateToDocument: vi.fn() }));
vi.mock("@/lib/sync/export-download", () => ({ downloadEncryptedExport: vi.fn(() => "na-escuta-pendencias-2026-09-20.json") }));

const REVOKED = "01991b1a-0000-7000-8000-0000000000a0";
const OTHER = "01991b1a-0000-7000-8000-0000000000b0";
const NOW = "2026-09-19T10:00:00.000Z";

function op(eventId: string, id: string, payload: Record<string, unknown> = { title: id }): OutboxOperation {
  return {
    id, companyId: "c1", eventId, entityType: "Task", entityId: `${id}-entity`, operationType: "CREATE", payload,
    baseVersion: null, status: "FAILED", attempts: 1, lastAttemptAt: NOW, nextAttemptAt: NOW, lastError: "EVENT_ACCESS_REVOKED",
    createdAt: NOW, deviceId: "device-1",
  };
}

async function putRevokedState(eventId = REVOKED) {
  await getDb().syncState.put({
    key: eventId, cursor: null, lastSyncAt: NOW, lastFullBootstrapAt: null, expectedCounts: null,
    accessRevokedAt: NOW, accessRevokedReason: "EVENT_ACCESS_REVOKED",
  });
}

async function putEvidenceWithFile(eventId: string, id: string) {
  await getDb().occurrenceEvidence.put({
    id, occurrenceId: "occ", eventId, companyId: "c1", kind: "PHOTO", fileName: "foto.jpg", mimeType: "image/jpeg", sizeBytes: 4,
    storageKey: null, checksumSha256: "abc", capturedAt: NOW, uploadedAt: null, version: 1, syncStatus: "synced",
    createdAt: NOW, updatedAt: NOW, deletedAt: null, createdBy: null, updatedBy: null,
  });
  await getDb().evidenceBlobs.put({ id, blob: new Blob(["foto"], { type: "image/jpeg" }) });
}

describe("RevokedEventPanel", () => {
  beforeEach(() => resetDbInstanceForTests());
  afterEach(async () => {
    cleanup();
    vi.mocked(navigateToDocument).mockClear();
    vi.mocked(downloadEncryptedExport).mockClear();
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  it("explica o motivo em palavras e que o que o servidor guarda saiu do aparelho", async () => {
    await putRevokedState();
    render(<RevokedEventPanel eventId={REVOKED} reason="EVENT_ACCESS_REVOKED" />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Seu acesso a este evento foi retirado.");
    expect(alert).toHaveTextContent(/já estão guardados no servidor foram removidos deste aparelho/);
    expect(alert).not.toHaveTextContent("EVENT_ACCESS_REVOKED");
  });

  it("não afirma 'não ficou nada' antes de terminar de contar (a consulta ainda carrega)", async () => {
    await putRevokedState();
    render(<RevokedEventPanel eventId={REVOKED} reason={null} />);

    // Primeiro quadro: a contagem ainda não voltou do IndexedDB.
    expect(screen.queryByText(/Não ficou nada/)).not.toBeInTheDocument();
    expect(await screen.findByText(/Não ficou nada que exista só neste aparelho/)).toBeInTheDocument();
  });

  it("mostra o que sobrou: alterações não enviadas e arquivos que só existem no aparelho — só deste evento", async () => {
    await putRevokedState();
    await getDb().outbox.bulkAdd([op(REVOKED, "a"), op(REVOKED, "b"), op(OTHER, "de-outro-evento")]);
    await putEvidenceWithFile(REVOKED, "foto-1");
    render(<RevokedEventPanel eventId={REVOKED} reason="EVENT_ACCESS_REVOKED" />);

    expect(await screen.findByText("2 alterações não enviadas")).toBeInTheDocument();
    expect(screen.getByText("1 arquivo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar alterações não enviadas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover do aparelho" })).toBeInTheDocument();
  });

  it("no singular, fala no singular", async () => {
    await putRevokedState();
    await getDb().outbox.add(op(REVOKED, "a"));
    render(<RevokedEventPanel eventId={REVOKED} reason={null} />);

    expect(await screen.findByText("1 alteração não enviada")).toBeInTheDocument();
  });

  describe("exportar", () => {
    it("exige uma senha de pelo menos 8 caracteres e não exporta sem ela", async () => {
      const user = userEvent.setup();
      await putRevokedState();
      await getDb().outbox.add(op(REVOKED, "a"));
      render(<RevokedEventPanel eventId={REVOKED} reason={null} />);

      await user.click(await screen.findByRole("button", { name: "Exportar alterações não enviadas" }));
      await user.type(screen.getByLabelText("Senha para proteger o arquivo exportado"), "curta");
      await user.click(screen.getByRole("button", { name: "Exportar arquivo cifrado" }));

      expect(await screen.findByTestId("revoked-error")).toHaveTextContent(/pelo menos 8 caracteres/);
      expect(downloadEncryptedExport).not.toHaveBeenCalled();
    });

    it("entrega um arquivo cifrado com SÓ as alterações deste evento, que só abre com a senha", async () => {
      const user = userEvent.setup();
      await putRevokedState();
      await getDb().outbox.bulkAdd([op(REVOKED, "a", { title: "Minha tarefa de campo" }), op(OTHER, "de-outro-evento")]);
      render(<RevokedEventPanel eventId={REVOKED} reason={null} />);

      await user.click(await screen.findByRole("button", { name: "Exportar alterações não enviadas" }));
      await user.type(screen.getByLabelText("Senha para proteger o arquivo exportado"), "senha-longa-123");
      await user.click(screen.getByRole("button", { name: "Exportar arquivo cifrado" }));

      await screen.findByText("Exportado: na-escuta-pendencias-2026-09-20.json");
      const encrypted = vi.mocked(downloadEncryptedExport).mock.calls[0]![0] as EncryptedExport;
      const data = await decryptPendingExport(encrypted, "senha-longa-123");
      expect((data.outbox as OutboxOperation[]).map((o) => o.id)).toEqual(["a"]);
      await expect(decryptPendingExport(encrypted, "senha-errada")).rejects.toThrow();
      // Exportar NÃO apaga nada: a pessoa ainda decide o que fazer com o que ficou.
      expect(await getDb().outbox.count()).toBe(2);
    });

    it("sem alterações não enviadas (só arquivos), não oferece exportar — o arquivo cifrado levaria só as alterações", async () => {
      await putRevokedState();
      await putEvidenceWithFile(REVOKED, "foto-1");
      render(<RevokedEventPanel eventId={REVOKED} reason={null} />);

      await screen.findByText("1 arquivo");
      expect(screen.queryByRole("button", { name: "Exportar alterações não enviadas" })).not.toBeInTheDocument();
    });
  });

  describe("remover do aparelho", () => {
    it("pede confirmação dizendo o que se perde, e Cancelar não apaga nada", async () => {
      const user = userEvent.setup();
      await putRevokedState();
      await getDb().outbox.add(op(REVOKED, "a"));
      await putEvidenceWithFile(REVOKED, "foto-1");
      render(<RevokedEventPanel eventId={REVOKED} reason={null} />);

      await user.click(await screen.findByRole("button", { name: "Remover do aparelho" }));

      expect(screen.getByText(/agora e para sempre/)).toBeInTheDocument();
      expect(screen.getByText(/1 alteração e 1 arquivo/)).toBeInTheDocument();
      expect(screen.getByText(/nada\s+disso existe em outro lugar/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Cancelar" }));

      expect(await getDb().outbox.count()).toBe(1);
      expect(await getDb().evidenceBlobs.count()).toBe(1);
      expect(await getDb().syncState.get(REVOKED)).toBeDefined();
      expect(navigateToDocument).not.toHaveBeenCalled();
    });

    it("confirmado, apaga o que ficou (e só deste evento) e sai da tela do evento", async () => {
      const user = userEvent.setup();
      await putRevokedState();
      await getDb().outbox.bulkAdd([op(REVOKED, "a"), op(OTHER, "de-outro-evento")]);
      await putEvidenceWithFile(REVOKED, "foto-1");
      render(<RevokedEventPanel eventId={REVOKED} reason={null} />);

      await user.click(await screen.findByRole("button", { name: "Remover do aparelho" }));
      await user.click(screen.getByRole("button", { name: "Sim, remover do aparelho" }));

      await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith("/eventos"));
      expect((await getDb().outbox.toArray()).map((o) => o.id)).toEqual(["de-outro-evento"]);
      expect(await getDb().evidenceBlobs.count()).toBe(0);
      expect(await getDb().syncState.get(REVOKED)).toBeUndefined();
    });

    it("sem nada que exista só no aparelho, 'Dispensar aviso' tira o aviso direto, sem confirmação", async () => {
      const user = userEvent.setup();
      await putRevokedState();
      render(<RevokedEventPanel eventId={REVOKED} reason={null} />);

      await user.click(await screen.findByRole("button", { name: "Dispensar aviso" }));

      await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith("/eventos"));
      expect(await getDb().syncState.get(REVOKED)).toBeUndefined();
    });

    it("se a remoção falhar, diz e NÃO navega (a pessoa não acha que apagou)", async () => {
      const user = userEvent.setup();
      // Sem o aviso de acesso retirado, `discardRevokedEventData` recusa: simula a falha.
      await getDb().syncState.put({ key: REVOKED, cursor: null, lastSyncAt: NOW, lastFullBootstrapAt: NOW, expectedCounts: null });
      await getDb().outbox.add(op(REVOKED, "a"));
      render(<RevokedEventPanel eventId={REVOKED} reason={null} />);

      await user.click(await screen.findByRole("button", { name: "Remover do aparelho" }));
      await user.click(screen.getByRole("button", { name: "Sim, remover do aparelho" }));

      expect(await screen.findByTestId("revoked-error")).toHaveTextContent(/Não foi possível remover/);
      expect(navigateToDocument).not.toHaveBeenCalled();
      expect(await getDb().outbox.count()).toBe(1);
    });
  });
});
