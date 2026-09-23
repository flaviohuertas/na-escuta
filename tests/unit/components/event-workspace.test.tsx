import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventWorkspace } from "@/components/events/EventWorkspace";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";
import { OFFLINE_PAGES_CACHE_NAME, eventOfflineRoutes } from "@/lib/offline/routes";
import { installFakeCaches } from "../helpers/fake-caches";

const eventId = "01991b1a-0000-7000-8000-0000000000e1";
const PREPARE_BUTTON = "Preparar evento para uso offline";
const CACHE_BUTTON = "Guardar telas para uso sem internet";

async function putEvent() {
  await getDb().events.put({
    id: eventId,
    companyId: "company-1",
    name: "Festival de Teste",
    description: null,
    location: "Parque",
    startDate: "2026-10-01T12:00:00.000Z",
    endDate: "2026-10-02T12:00:00.000Z",
    status: "CONFIRMED",
    version: 1,
    syncStatus: "synced",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
  });
}

describe("EventWorkspace", () => {
  beforeEach(() => {
    resetDbInstanceForTests();
  });

  afterEach(async () => {
    // Sem `globals: true` o Testing Library não desmonta sozinho — e um componente
    // ainda montado reage (via live query) às gravações do teste seguinte.
    cleanup();
    vi.unstubAllGlobals();
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  it("evento ausente no Dexie mostra o convite para preparar, não 'Carregando…' para sempre", async () => {
    render(<EventWorkspace eventId={eventId} />);

    // Regressão: events.get() de id inexistente resolve `undefined`, igual ao estado
    // de carregamento do useLiveQuery — a tela travava em "Carregando…".
    expect(await screen.findByText("Evento ainda não preparado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PREPARE_BUTTON })).toBeInTheDocument();
    expect(screen.queryByText("Carregando…")).not.toBeInTheDocument();
    // Sem o evento local, as telas operacionais não fazem sentido ainda.
    expect(screen.queryByRole("link", { name: "Tarefas" })).not.toBeInTheDocument();
  });

  it("antes da preparação, com o resumo do servidor, a tela diz QUAL evento é e leva de volta à lista", async () => {
    render(
      <EventWorkspace
        eventId={eventId}
        summary={{ name: "Festival de Teste", startDate: "2026-10-01T12:00:00.000Z", endDate: "2026-10-02T12:00:00.000Z", location: "Parque" }}
      />
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Festival de Teste" })).toBeInTheDocument();
    expect(screen.getByText(/01\/10\/2026.*02\/10\/2026 · Parque/)).toBeInTheDocument();
    expect(screen.getByText("Não preparado")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Eventos" })).toHaveAttribute("href", "/eventos");
    expect(screen.getByRole("button", { name: PREPARE_BUTTON })).toBeInTheDocument();
    expect(screen.queryByText("Evento ainda não preparado")).not.toBeInTheDocument();
  });

  it("evento baixado mas com preparação incompleta avisa e mantém o botão de preparar", async () => {
    await putEvent();
    render(<EventWorkspace eventId={eventId} />);

    expect(await screen.findByRole("heading", { name: "Festival de Teste" })).toBeInTheDocument();
    expect(screen.getByText("Preparação incompleta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: PREPARE_BUTTON })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tarefas" })).toBeInTheDocument();
  });

  async function putPreparedState() {
    await getDb().syncState.put({
      key: eventId,
      cursor: "cursor-1",
      lastSyncAt: "2026-09-18T12:00:00.000Z",
      lastFullBootstrapAt: "2026-09-18T12:00:00.000Z",
      expectedCounts: null,
    });
  }

  it("evento preparado COM as telas guardadas mostra 'Disponível offline', sem botões de preparar/guardar", async () => {
    installFakeCaches({ [OFFLINE_PAGES_CACHE_NAME]: eventOfflineRoutes(eventId) });
    await putEvent();
    await putPreparedState();
    render(<EventWorkspace eventId={eventId} />);

    expect(await screen.findByText("Disponível offline")).toBeInTheDocument();
    expect(screen.queryByText("Preparação incompleta")).not.toBeInTheDocument();
    expect(screen.queryByText("Telas não guardadas")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: PREPARE_BUTTON })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CACHE_BUTTON })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Checklists" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ocorrências" })).toBeInTheDocument();
  });

  it("dados preparados mas telas fora do cache NÃO diz 'Disponível offline' e oferece guardá-las", async () => {
    // O navegador limpou o cache (ou o logout o apagou): os dados seguem no Dexie, as telas não.
    installFakeCaches();
    await putEvent();
    await putPreparedState();
    render(<EventWorkspace eventId={eventId} />);

    expect(await screen.findByText("Telas não guardadas")).toBeInTheDocument();
    expect(screen.queryByText("Disponível offline")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: CACHE_BUTTON })).toBeInTheDocument();
    // Já está preparado: o botão de preparar dados não faz sentido.
    expect(screen.queryByRole("button", { name: PREPARE_BUTTON })).not.toBeInTheDocument();
  });

  it("sem Cache Storage no navegador, nunca promete 'Disponível offline'", async () => {
    await putEvent();
    await putPreparedState();
    render(<EventWorkspace eventId={eventId} />);

    expect(await screen.findByText("Telas não guardadas")).toBeInTheDocument();
    expect(screen.queryByText("Disponível offline")).not.toBeInTheDocument();
  });

  describe("acesso ao evento retirado", () => {
    // O estado que `purgeRevokedEventData` deixa: o evento saiu do aparelho, só o aviso ficou.
    async function putPurgedState(reason: string | null) {
      await getDb().syncState.put({
        key: eventId,
        cursor: null,
        lastSyncAt: "2026-09-18T12:00:00.000Z",
        lastFullBootstrapAt: null,
        expectedCounts: null,
        accessRevokedAt: "2026-09-19T12:00:00.000Z",
        accessRevokedReason: reason,
      });
    }

    it("explica, com o motivo em palavras, que o acesso foi retirado e que os dados saíram do aparelho", async () => {
      await putPurgedState("EVENT_ACCESS_REVOKED");
      render(<EventWorkspace eventId={eventId} />);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Seu acesso a este evento foi retirado.");
      expect(alert).toHaveTextContent(/foram removidos deste aparelho/);
      expect(alert).not.toHaveTextContent("EVENT_ACCESS_REVOKED");
    });

    it("não trata como 'evento ainda não preparado' nem oferece as telas do evento: ele não está mais aqui", async () => {
      await putPurgedState("EVENT_ACCESS_REVOKED");
      render(<EventWorkspace eventId={eventId} />);

      await screen.findByRole("alert");
      expect(screen.queryByText("Evento ainda não preparado")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Tarefas" })).not.toBeInTheDocument();
      // Mas deixa preparar de novo: é o caminho de volta quando o acesso é devolvido.
      expect(screen.getByRole("button", { name: PREPARE_BUTTON })).toBeInTheDocument();
    });

    it("mostra o que ficou só neste aparelho (alterações não enviadas) e como agir", async () => {
      await putPurgedState("EVENT_ACCESS_REVOKED");
      await getDb().outbox.add({
        id: "01991b1a-0000-7000-8000-0000000000c1",
        companyId: "company-1",
        eventId,
        entityType: "Task",
        entityId: "t1",
        operationType: "CREATE",
        payload: { title: "Criada em campo" },
        baseVersion: null,
        status: "FAILED",
        attempts: 1,
        lastAttemptAt: "2026-09-19T11:00:00.000Z",
        nextAttemptAt: "2026-09-19T11:00:00.000Z",
        lastError: "EVENT_ACCESS_REVOKED",
        createdAt: "2026-09-19T10:30:00.000Z",
        deviceId: "device-1",
      });
      render(<EventWorkspace eventId={eventId} />);

      expect(await screen.findByText("1 alteração não enviada")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Exportar alterações não enviadas" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remover do aparelho" })).toBeInTheDocument();
    });

    it("um aparelho que ainda tem o evento inteiro com o aviso (dados de antes da limpeza) não mostra o cabeçalho nem os atalhos dele", async () => {
      // O sync seguinte o limpa; até lá a tela não pode oferecer o que o acesso já não permite.
      await putEvent();
      await putPreparedState();
      await getDb().syncState.update(eventId, {
        accessRevokedAt: "2026-09-19T12:00:00.000Z",
        accessRevokedReason: "EVENT_ACCESS_REVOKED",
      });
      render(<EventWorkspace eventId={eventId} />);

      await screen.findByRole("alert");
      expect(screen.queryByRole("heading", { name: "Festival de Teste" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Tarefas" })).not.toBeInTheDocument();
    });

    it("sem aviso quando o acesso está normal", async () => {
      await putEvent();
      await putPreparedState();
      render(<EventWorkspace eventId={eventId} />);

      await screen.findByRole("heading", { name: "Festival de Teste" });
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("o aviso some quando a preparação regrava o registro (acesso devolvido e evento preparado de novo)", async () => {
      await putPurgedState("MEMBERSHIP_REVOKED");
      render(<EventWorkspace eventId={eventId} />);
      expect(await screen.findByRole("alert")).toBeInTheDocument();

      await putEvent();
      await putPreparedState();

      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      expect(await screen.findByRole("heading", { name: "Festival de Teste" })).toBeInTheDocument();
    });
  });
});
