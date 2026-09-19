import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChecklistDetailFromQuery } from "@/components/checklists/ChecklistDetailFromQuery";
import { OccurrenceDetailFromQuery } from "@/components/occurrences/OccurrenceDetailFromQuery";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";

// `useSearchParams` só existe dentro do roteador do Next; aqui a query é controlada pelo teste.
let currentQuery = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => currentQuery }));

const eventId = "01991b1a-0000-7000-8000-000000000010";
const companyId = "01991b1a-0000-7000-8000-000000000099";
const props = { eventId, userId: "user-1", companyId };

const sync = {
  version: 1,
  syncStatus: "synced" as const,
  createdAt: "2026-09-19T10:00:00.000Z",
  updatedAt: "2026-09-19T10:00:00.000Z",
  deletedAt: null,
  createdBy: null,
  updatedBy: null,
};

describe("detalhe numa rota fixa (id na query)", () => {
  beforeEach(() => {
    resetDbInstanceForTests();
    currentQuery = new URLSearchParams();
  });

  afterEach(async () => {
    cleanup();
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  describe("checklist", () => {
    it("abre o checklist cujo id vem na query — inclusive um criado só neste aparelho", async () => {
      await getDb().checklists.put({
        id: "chk-criado-offline",
        eventId,
        companyId,
        title: "Montagem do palco",
        description: null,
        ...sync,
        syncStatus: "pending", // ainda não foi ao servidor: a URL dele nunca existiu em nenhum cache
      });
      currentQuery = new URLSearchParams({ id: "chk-criado-offline" });

      render(<ChecklistDetailFromQuery {...props} />);

      expect(await screen.findByRole("heading", { name: "Montagem do palco" })).toBeInTheDocument();
    });

    it("sem ?id= avisa e oferece voltar, em vez de quebrar", () => {
      render(<ChecklistDetailFromQuery {...props} />);

      expect(screen.getByText("Nenhum checklist foi indicado.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Voltar aos checklists/ })).toHaveAttribute(
        "href",
        `/eventos/${eventId}/checklists`
      );
    });

    it("id que não existe neste aparelho mostra 'não encontrado', não 'Carregando…' para sempre", async () => {
      // Regressão: `get()` de id ausente resolve `undefined`, igual ao estado de carregamento.
      currentQuery = new URLSearchParams({ id: "nao-existe" });

      render(<ChecklistDetailFromQuery {...props} />);

      expect(await screen.findByText("Checklist não encontrado")).toBeInTheDocument();
      expect(screen.queryByText("Carregando…")).not.toBeInTheDocument();
    });
  });

  describe("ocorrência", () => {
    it("abre a ocorrência cujo id vem na query — inclusive uma registrada só neste aparelho", async () => {
      await getDb().occurrences.put({
        id: "occ-criada-offline",
        eventId,
        companyId,
        title: "Falha no gerador",
        description: null,
        category: null,
        severity: "HIGH",
        status: "OPEN",
        occurredAt: "2026-09-19T11:00:00.000Z",
        reportedByUserId: null,
        assignedToUserId: null,
        resolutionNotes: null,
        ...sync,
        syncStatus: "pending",
      });
      currentQuery = new URLSearchParams({ id: "occ-criada-offline" });

      render(<OccurrenceDetailFromQuery {...props} />);

      expect(await screen.findByRole("heading", { name: "Falha no gerador" })).toBeInTheDocument();
    });

    it("sem ?id= avisa e oferece voltar", () => {
      render(<OccurrenceDetailFromQuery {...props} />);

      expect(screen.getByText("Nenhuma ocorrência foi indicada.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Voltar às ocorrências/ })).toHaveAttribute(
        "href",
        `/eventos/${eventId}/ocorrencias`
      );
    });

    it("id que não existe neste aparelho mostra 'não encontrada', não 'Carregando…' para sempre", async () => {
      currentQuery = new URLSearchParams({ id: "nao-existe" });

      render(<OccurrenceDetailFromQuery {...props} />);

      expect(await screen.findByText("Ocorrência não encontrada")).toBeInTheDocument();
      expect(screen.queryByText("Carregando…")).not.toBeInTheDocument();
    });
  });
});
