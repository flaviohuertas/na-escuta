import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventForm, type EventFormInitial } from "@/components/events/EventForm";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";
import { navigateToDocument } from "@/lib/offline/navigate";

vi.mock("@/lib/offline/navigate", () => ({ navigateToDocument: vi.fn() }));

const eventId = "01991b1a-0000-7000-8000-000000000010";
const companyId = "01991b1a-0000-7000-8000-000000000099";

const initial: EventFormInitial = {
  id: eventId,
  name: "Festival",
  description: null,
  location: "Parque",
  startDate: "2026-10-01T12:00:00.000Z",
  endDate: "2026-10-02T12:00:00.000Z",
  status: "PLANNED",
  version: 3,
};

/** O evento como o servidor devolve depois de salvar (Prisma serializado). */
const savedEvent = {
  id: eventId,
  companyId,
  name: "Festival Renomeado",
  description: null,
  location: "Parque",
  startDate: "2026-10-01T12:00:00.000Z",
  endDate: "2026-10-02T12:00:00.000Z",
  status: "PLANNED",
  version: 4,
  createdBy: null,
  updatedBy: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-09-19T15:00:00.000Z",
  deletedAt: null,
};

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("EventForm", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetDbInstanceForTests();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });

  afterEach(async () => {
    cleanup();
    fetchMock.mockReset();
    vi.mocked(navigateToDocument).mockClear();
    vi.unstubAllGlobals();
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  describe("criar", () => {
    async function fillValid(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByLabelText("Nome do evento"), "Show de Outubro");
      await user.type(screen.getByLabelText("Início"), "2026-10-01T20:00");
      await user.type(screen.getByLabelText("Término"), "2026-10-02T02:00");
    }

    it("envia os dados (datas em ISO com fuso) e, salvo, vai para o evento criado", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(201, { event: { ...savedEvent, name: "Show de Outubro", version: 1 } }));
      render(<EventForm mode="create" />);

      await fillValid(user);
      await user.click(screen.getByRole("button", { name: "Criar evento" }));

      await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith(`/eventos/${eventId}`));
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/eventos");
      expect(init.method).toBe("POST");
      const sent = JSON.parse(init.body);
      expect(sent).toMatchObject({ name: "Show de Outubro", status: "PLANNED", description: null, location: null });
      expect(sent.startDate).toMatch(/Z$/);
      expect(sent).not.toHaveProperty("baseVersion");
    });

    it("término antes do início é apontado no campo, sem ir ao servidor", async () => {
      const user = userEvent.setup();
      render(<EventForm mode="create" />);
      await user.type(screen.getByLabelText("Nome do evento"), "Show");
      await user.type(screen.getByLabelText("Início"), "2026-10-02T20:00");
      await user.type(screen.getByLabelText("Término"), "2026-10-01T20:00");

      await user.click(screen.getByRole("button", { name: "Criar evento" }));

      expect(await screen.findByText("A data de término não pode ser anterior à data de início")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sem nome, avisa no campo e não envia", async () => {
      const user = userEvent.setup();
      render(<EventForm mode="create" />);
      await user.type(screen.getByLabelText("Início"), "2026-10-01T20:00");
      await user.type(screen.getByLabelText("Término"), "2026-10-02T02:00");

      await user.click(screen.getByRole("button", { name: "Criar evento" }));

      expect(await screen.findByText("Informe o nome do evento")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sem conexão, diz que exige internet, NÃO tenta enviar e mantém o que foi digitado", async () => {
      const user = userEvent.setup();
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      render(<EventForm mode="create" />);
      await fillValid(user);

      await user.click(screen.getByRole("button", { name: "Criar evento" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/exige internet/);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Nome do evento")).toHaveValue("Show de Outubro");
      expect(navigateToDocument).not.toHaveBeenCalled();
    });

    it("rede que cai no meio do envio (fetch rejeita) dá a mesma orientação, sem perder o formulário", async () => {
      const user = userEvent.setup();
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      render(<EventForm mode="create" />);
      await fillValid(user);

      await user.click(screen.getByRole("button", { name: "Criar evento" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/exige internet/);
      expect(screen.getByLabelText("Nome do evento")).toHaveValue("Show de Outubro");
      expect(screen.getByRole("button", { name: "Criar evento" })).toBeEnabled();
    });

    it("erros por campo do servidor (422) aparecem ao lado do campo", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(
        respond(422, { error: "Confira os campos destacados.", fieldErrors: { location: ["Local muito longo"] } })
      );
      render(<EventForm mode="create" />);
      await fillValid(user);

      await user.click(screen.getByRole("button", { name: "Criar evento" }));

      expect(await screen.findByText("Local muito longo")).toBeInTheDocument();
    });

    it("sessão expirada (401) explica e não descarta o que foi digitado", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(401, { error: "SESSION_EXPIRED" }));
      render(<EventForm mode="create" />);
      await fillValid(user);

      await user.click(screen.getByRole("button", { name: "Criar evento" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/sessão expirou/);
      expect(screen.getByLabelText("Nome do evento")).toHaveValue("Show de Outubro");
    });

    it("sem permissão (403) mostra a mensagem do servidor", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(403, { error: "Você não tem permissão para criar eventos nesta empresa." }));
      render(<EventForm mode="create" />);
      await fillValid(user);

      await user.click(screen.getByRole("button", { name: "Criar evento" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Você não tem permissão para criar eventos");
      expect(navigateToDocument).not.toHaveBeenCalled();
    });
  });

  describe("editar", () => {
    it("vem preenchido e envia PATCH com a versão que a pessoa estava vendo", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(200, { event: savedEvent }));
      render(<EventForm mode="edit" initial={initial} />);
      expect(screen.getByLabelText("Nome do evento")).toHaveValue("Festival");
      expect(screen.getByLabelText("Local")).toHaveValue("Parque");

      await user.clear(screen.getByLabelText("Nome do evento"));
      await user.type(screen.getByLabelText("Nome do evento"), "Festival Renomeado");
      await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

      await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith(`/eventos/${eventId}`));
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(`/api/eventos/${eventId}`);
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body)).toMatchObject({ name: "Festival Renomeado", baseVersion: 3 });
    });

    it("se este aparelho já preparou o evento, a cópia local muda na hora (não fica com o nome antigo até o próximo sync)", async () => {
      const user = userEvent.setup();
      await getDb().events.put({
        id: eventId,
        companyId,
        name: "Festival",
        description: null,
        location: "Parque",
        startDate: initial.startDate,
        endDate: initial.endDate,
        status: "PLANNED",
        version: 3,
        syncStatus: "synced",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        deletedAt: null,
        createdBy: "quem-criou",
        updatedBy: null,
      });
      fetchMock.mockReturnValue(respond(200, { event: savedEvent }));
      render(<EventForm mode="edit" initial={initial} />);

      await user.clear(screen.getByLabelText("Nome do evento"));
      await user.type(screen.getByLabelText("Nome do evento"), "Festival Renomeado");
      await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
      await waitFor(() => expect(navigateToDocument).toHaveBeenCalled());

      const local = await getDb().events.get(eventId);
      expect(local).toMatchObject({ name: "Festival Renomeado", version: 4, createdBy: "quem-criou" });
    });

    it("se o aparelho NÃO tem o evento preparado, salvar não cria uma cópia parcial no IndexedDB", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(200, { event: savedEvent }));
      render(<EventForm mode="edit" initial={initial} />);

      await user.click(screen.getByRole("button", { name: "Salvar alterações" }));
      await waitFor(() => expect(navigateToDocument).toHaveBeenCalled());

      expect(await getDb().events.get(eventId)).toBeUndefined();
    });

    it("evento alterado por outra pessoa (409): avisa e oferece carregar os dados atuais, sem sobrescrever", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(
        respond(409, { error: "Este evento foi alterado por outra pessoa enquanto você editava.", event: savedEvent })
      );
      render(<EventForm mode="edit" initial={initial} />);

      await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/alterado por outra pessoa/);
      expect(screen.getByRole("button", { name: "Carregar os dados atuais" })).toBeInTheDocument();
      expect(navigateToDocument).not.toHaveBeenCalled();
    });
  });
});
