import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceRevocationGuard } from "@/components/sync/DeviceRevocationGuard";
import { checkDeviceStatus } from "@/lib/auth/device-check";
import { getDb, resetDbInstanceForTests, type OutboxOperation } from "@/lib/db/dexie/db";
import { navigateToDocument } from "@/lib/offline/navigate";
import { downloadEncryptedExport } from "@/lib/sync/export-download";
import { decryptPendingExport, type EncryptedExport } from "@/lib/sync/export-pending";
import { addEvidence, op, seedEvent } from "../helpers/local-fixtures";

vi.mock("@/lib/auth/device-check", () => ({ checkDeviceStatus: vi.fn(async () => "valid") }));
vi.mock("@/lib/offline/navigate", () => ({ navigateToDocument: vi.fn() }));
vi.mock("@/lib/sync/export-download", () => ({ downloadEncryptedExport: vi.fn(() => "na-escuta-pendencias-2026-09-20.json") }));

const A = "01991b1a-0000-7000-8000-0000000000a0";
const NOW = "2026-09-19T10:00:00.000Z";

async function putRevocation(reason: string | null = "MEMBERSHIP_REVOKED") {
  await getDb().deviceState.put({ key: "revocation", revokedAt: NOW, reason, userId: "user-1" });
}

describe("DeviceRevocationGuard", () => {
  beforeEach(() => {
    resetDbInstanceForTests();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    vi.mocked(checkDeviceStatus).mockReset().mockResolvedValue("valid");
    vi.mocked(navigateToDocument).mockClear();
    vi.mocked(downloadEncryptedExport).mockClear();
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  describe("perguntar ao servidor se o aparelho ainda vale", () => {
    it("pergunta ao abrir a página (qualquer uma, inclusive /login) e não mostra nada quando está tudo bem", async () => {
      render(<DeviceRevocationGuard />);

      await waitFor(() => expect(checkDeviceStatus).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("sem conexão, não pergunta (não há a quem)", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

      render(<DeviceRevocationGuard />);
      window.dispatchEvent(new Event("online"));

      expect(checkDeviceStatus).not.toHaveBeenCalled();
    });

    it("pergunta de novo quando a conexão volta — mas não a cada estalo dela (intervalo mínimo)", async () => {
      const now = vi.spyOn(Date, "now");
      now.mockReturnValue(1_000_000);
      render(<DeviceRevocationGuard />);
      await waitFor(() => expect(checkDeviceStatus).toHaveBeenCalledTimes(1));

      now.mockReturnValue(1_000_000 + 5_000); // conexão oscilando
      window.dispatchEvent(new Event("online"));
      window.dispatchEvent(new Event("online"));
      expect(checkDeviceStatus).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000_000 + 31_000); // passou o intervalo
      window.dispatchEvent(new Event("online"));
      expect(checkDeviceStatus).toHaveBeenCalledTimes(2);
    });

    it("pergunta de novo quando a aba volta a ficar visível (depois do intervalo)", async () => {
      const now = vi.spyOn(Date, "now");
      now.mockReturnValue(2_000_000);
      render(<DeviceRevocationGuard />);
      await waitFor(() => expect(checkDeviceStatus).toHaveBeenCalledTimes(1));

      now.mockReturnValue(2_000_000 + 60_000);
      document.dispatchEvent(new Event("visibilitychange"));

      expect(checkDeviceStatus).toHaveBeenCalledTimes(2);
    });

    it("com a página aberta o tempo todo, pergunta de tempos em tempos", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      render(<DeviceRevocationGuard />);
      await vi.waitFor(() => expect(checkDeviceStatus).toHaveBeenCalledTimes(1));

      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1000);

      expect(checkDeviceStatus).toHaveBeenCalledTimes(2);
    });

    it("se a checagem lançar, a página não cai", async () => {
      vi.mocked(checkDeviceStatus).mockRejectedValue(new Error("boom"));

      render(<DeviceRevocationGuard />);

      await waitFor(() => expect(checkDeviceStatus).toHaveBeenCalled());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("para de perguntar ao desmontar (nada de temporizador vazando entre páginas)", async () => {
      const { unmount } = render(<DeviceRevocationGuard />);
      await waitFor(() => expect(checkDeviceStatus).toHaveBeenCalledTimes(1));
      unmount();

      window.dispatchEvent(new Event("online"));

      expect(checkDeviceStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe("o aviso de aparelho revogado", () => {
    it("explica o motivo em palavras e que os dados da empresa saíram do aparelho", async () => {
      await putRevocation("MEMBERSHIP_REVOKED");
      render(<DeviceRevocationGuard />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Seu vínculo com a empresa foi encerrado.");
      expect(alert).toHaveTextContent(/dados da empresa que estavam guardados neste aparelho foram removidos/);
      expect(alert).not.toHaveTextContent("MEMBERSHIP_REVOKED");
    });

    it("mostra o que ficou só no aparelho, de TODOS os eventos", async () => {
      await putRevocation();
      await getDb().outbox.bulkAdd([op(A, "a"), op("outro-evento", "b")]);
      await addEvidence(getDb(), A, "a", { withFile: true });
      render(<DeviceRevocationGuard />);

      expect(await screen.findByText("2 alterações não enviadas")).toBeInTheDocument();
      expect(screen.getByText("1 arquivo")).toBeInTheDocument();
    });

    it("some quando o aviso deixa de existir (a pessoa entrou de novo e o acesso voltou)", async () => {
      await putRevocation();
      render(<DeviceRevocationGuard />);
      await screen.findByRole("alert");

      await getDb().deviceState.delete("revocation");

      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });

    it("exportar entrega o arquivo cifrado com as alterações de TODOS os eventos e não apaga nada", async () => {
      const user = userEvent.setup();
      await putRevocation();
      await getDb().outbox.bulkAdd([op(A, "a", { status: "FAILED" }), op("outro-evento", "b", { status: "FAILED" })]);
      render(<DeviceRevocationGuard />);

      await user.click(await screen.findByRole("button", { name: "Exportar alterações não enviadas" }));
      await user.type(screen.getByLabelText("Senha para proteger o arquivo exportado"), "senha-longa-123");
      await user.click(screen.getByRole("button", { name: "Exportar arquivo cifrado" }));

      await screen.findByText("Exportado: na-escuta-pendencias-2026-09-20.json");
      const data = await decryptPendingExport(vi.mocked(downloadEncryptedExport).mock.calls[0]![0] as EncryptedExport, "senha-longa-123");
      expect((data.outbox as OutboxOperation[]).map((o) => o.id).sort()).toEqual(["a", "b"]);
      expect(await getDb().outbox.count()).toBe(2);
    });

    it("remover pede confirmação, apaga TUDO (com o banco aberto) e leva para o login", async () => {
      const user = userEvent.setup();
      await putRevocation();
      await seedEvent(getDb(), A, "a"); // resíduo qualquer
      await getDb().outbox.add(op(A, "a", { status: "FAILED" }));
      await addEvidence(getDb(), A, "a", { withFile: true });
      render(<DeviceRevocationGuard />);

      await user.click(await screen.findByRole("button", { name: "Remover do aparelho" }));
      expect(screen.getByText(/agora e para sempre/)).toBeInTheDocument();
      expect(screen.getByText(/1 alteração e 1 arquivo/)).toBeInTheDocument();
      expect(await getDb().outbox.count()).toBe(1); // ainda nada apagado
      await user.click(screen.getByRole("button", { name: "Sim, remover do aparelho" }));

      await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith("/login"));
      for (const table of getDb().tables) expect(await table.count(), table.name).toBe(0);
    });

    it("sem nada que exista só no aparelho, 'Dispensar aviso' tira o aviso direto", async () => {
      const user = userEvent.setup();
      await putRevocation();
      render(<DeviceRevocationGuard />);

      await user.click(await screen.findByRole("button", { name: "Dispensar aviso" }));

      await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith("/login"));
      expect(await getDb().deviceState.get("revocation")).toBeUndefined();
    });
  });
});
