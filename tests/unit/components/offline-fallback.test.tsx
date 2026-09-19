import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OfflineFallback } from "@/components/offline/OfflineFallback";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";

const companyId = "01991b1a-0000-7000-8000-000000000099";

async function putEvent(id: string, name: string, startDate: string, opts: { deletedAt?: string } = {}) {
  await getDb().events.put({
    id,
    companyId,
    name,
    description: null,
    location: null,
    startDate,
    endDate: startDate,
    status: "CONFIRMED",
    version: 1,
    syncStatus: "synced",
    createdAt: startDate,
    updatedAt: startDate,
    deletedAt: opts.deletedAt ?? null,
    createdBy: null,
    updatedBy: null,
  });
}

async function markPrepared(eventId: string) {
  await getDb().syncState.put({
    key: eventId,
    cursor: "c",
    lastSyncAt: "2026-09-19T12:00:00.000Z",
    lastFullBootstrapAt: "2026-09-19T12:00:00.000Z",
    expectedCounts: null,
  });
}

describe("OfflineFallback", () => {
  beforeEach(() => resetDbInstanceForTests());
  afterEach(async () => {
    cleanup();
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  it("explica o que houve e, sem eventos preparados, orienta a preparar um quando houver conexão", async () => {
    render(<OfflineFallback />);

    expect(screen.getByRole("heading", { name: "Esta tela precisa de internet" })).toBeInTheDocument();
    expect(await screen.findByText(/Nenhum evento foi preparado neste aparelho/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  it("lista os eventos PREPARADOS deste aparelho, em ordem de data, com link para o evento", async () => {
    await putEvent("e-tarde", "Festival de Verão", "2026-12-01T12:00:00.000Z");
    await putEvent("e-cedo", "Show de Outubro", "2026-10-01T12:00:00.000Z");
    await markPrepared("e-tarde");
    await markPrepared("e-cedo");

    render(<OfflineFallback />);

    const list = await screen.findByRole("list");
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Show de Outubro", "Festival de Verão"]);
    expect(links[0]).toHaveAttribute("href", "/eventos/e-cedo");
  });

  it("não lista evento baixado pela metade (sem preparação concluída) nem evento excluído", async () => {
    await putEvent("e-incompleto", "Só metade baixada", "2026-10-01T12:00:00.000Z");
    // sem syncState.lastFullBootstrapAt
    await putEvent("e-excluido", "Evento excluído", "2026-10-02T12:00:00.000Z", {
      deletedAt: "2026-09-19T12:00:00.000Z",
    });
    await markPrepared("e-excluido");

    render(<OfflineFallback />);

    expect(await screen.findByText(/Nenhum evento foi preparado neste aparelho/)).toBeInTheDocument();
    expect(screen.queryByText("Só metade baixada")).not.toBeInTheDocument();
    expect(screen.queryByText("Evento excluído")).not.toBeInTheDocument();
  });
});
