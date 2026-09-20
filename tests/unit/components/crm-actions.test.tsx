import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientArchiveButton } from "@/components/crm/ClientArchiveButton";
import { PipelineBoard, StageBadge } from "@/components/crm/CrmParts";
import { StageActions } from "@/components/crm/StageActions";
import type { OpportunityCard, PipelineColumn } from "@/server/crm/opportunity.service";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  refresh.mockClear();
  vi.unstubAllGlobals();
});

describe("StageActions", () => {
  const renderActions = (stage: "NEW" | "WON" | "LOST" | "NEGOTIATION", hasEvent = false) =>
    render(<StageActions opportunityId="o-1" version={3} stage={stage} hasEvent={hasEvent} />);

  it("oferece só os movimentos que o servidor permite: de 'Novo', as outras etapas em andamento, ganhar e perder", () => {
    renderActions("NEW");

    for (const label of ["Em contato", "Proposta enviada", "Negociação", "Ganho", "Perdido"]) {
      expect(screen.getByRole("button", { name: `Mover para ${label}` }), label).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Mover para Novo" })).not.toBeInTheDocument();
  });

  it("de ganho ou perdido, só REABRIR (nunca ganho ↔ perdido direto)", () => {
    renderActions("WON");

    expect(screen.getByText("Reabrir")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reabrir como Negociação" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Perdido/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ganho/ })).not.toBeInTheDocument();
  });

  it("depois de virar evento não há o que mover: nada é renderizado", () => {
    const { container } = renderActions("WON", true);
    expect(container).toBeEmptyDOMElement();
  });

  it("mover envia a etapa e a versão que a pessoa viu, e atualiza a tela", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { opportunity: { id: "o-1" } }));
    renderActions("NEW");

    await user.click(screen.getByRole("button", { name: "Mover para Em contato" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/comercial/oportunidades/o-1/etapa");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ stage: "CONTACTED", lostReason: null, baseVersion: 3 });
  });

  it("PERDER pede o motivo antes: sem ele não envia; com ele, envia o motivo", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { opportunity: { id: "o-1" } }));
    renderActions("NEGOTIATION");

    await user.click(screen.getByRole("button", { name: "Mover para Perdido" }));
    expect(screen.getByLabelText("Por que a oportunidade foi perdida?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirmar perda" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Diga por que a oportunidade foi perdida.");
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Por que a oportunidade foi perdida?"), "Foi para a concorrência");
    await user.click(screen.getByRole("button", { name: "Confirmar perda" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ stage: "LOST", lostReason: "Foi para a concorrência", baseVersion: 3 });
  });

  it("se outra pessoa mexeu primeiro (409), mostra a mensagem, oferece recarregar e NÃO atualiza a lista", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "Esta oportunidade foi alterada por outra pessoa enquanto você olhava." }));
    renderActions("NEW");

    await user.click(screen.getByRole("button", { name: "Mover para Ganho" }));

    expect(await screen.findByText(/alterada por outra pessoa/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Carregar a etapa atual" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sem conexão, diz que exige internet", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderActions("NEW");

    await user.click(screen.getByRole("button", { name: "Mover para Em contato" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Sem conexão/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ClientArchiveButton", () => {
  it("arquivar pede confirmação e só então envia (com a versão que a pessoa viu)", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { client: { id: "c-1" } }));
    render(<ClientArchiveButton clientId="c-1" version={5} archived={false} />);

    await user.click(screen.getByRole("button", { name: "Arquivar cliente" }));
    expect(screen.getByText(/Ele sai da lista e não recebe novas oportunidades/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar arquivamento" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/comercial/clientes/c-1/arquivo");
    expect(JSON.parse(init.body)).toEqual({ archived: true, baseVersion: 5 });
  });

  it("cancelar a confirmação não envia nada", async () => {
    const user = userEvent.setup();
    render(<ClientArchiveButton clientId="c-1" version={5} archived={false} />);

    await user.click(screen.getByRole("button", { name: "Arquivar cliente" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Arquivar cliente" })).toBeInTheDocument();
  });

  it("com oportunidade em andamento o servidor recusa e a mensagem aparece (nada é atualizado)", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "Este cliente tem 2 oportunidades em andamento. Conclua-as antes de arquivar." }));
    render(<ClientArchiveButton clientId="c-1" version={5} archived={false} />);

    await user.click(screen.getByRole("button", { name: "Arquivar cliente" }));
    await user.click(screen.getByRole("button", { name: "Confirmar arquivamento" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("2 oportunidades em andamento");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("reativar é direto (não perde nada), sem confirmação", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { client: { id: "c-1" } }));
    render(<ClientArchiveButton clientId="c-1" version={6} archived />);

    await user.click(screen.getByRole("button", { name: "Reativar cliente" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ archived: false, baseVersion: 6 });
  });
});

describe("PipelineBoard", () => {
  const card = (overrides: Partial<OpportunityCard> = {}): OpportunityCard => ({
    id: "o-1",
    title: "Casamento Silva",
    clientId: "c-1",
    clientName: "Família Silva",
    stage: "NEW",
    expectedValueCents: 1_500_000,
    expectedStartDate: new Date("2027-03-01T15:00:00.000Z"),
    ownerName: "Bia",
    eventId: null,
    closedAt: null,
    ...overrides,
  });
  const columns: PipelineColumn[] = [
    { stage: "NEW", count: 2, totalCents: 2_000_000, items: [card(), card({ id: "o-2", title: "Formatura", expectedValueCents: null, expectedStartDate: null, ownerName: null })] },
    { stage: "CONTACTED", count: 0, totalCents: 0, items: [] },
    { stage: "PROPOSAL_SENT", count: 0, totalCents: 0, items: [] },
    { stage: "NEGOTIATION", count: 0, totalCents: 0, items: [] },
  ];

  it("uma coluna por etapa, com a contagem e o valor SOMADO, e cada cartão leva à oportunidade", () => {
    render(<PipelineBoard columns={columns} />);

    const newColumn = screen.getByTestId("column-NEW");
    expect(within(newColumn).getByRole("heading", { name: /Novo/ })).toHaveTextContent("(2)");
    expect(newColumn).toHaveTextContent(/R\$\s?20\.000,00/);
    const [first, second] = within(newColumn).getAllByTestId("opportunity-card");
    expect(first).toHaveAttribute("href", "/comercial/oportunidades/o-1");
    expect(first).toHaveTextContent("Casamento Silva");
    expect(first).toHaveTextContent("Família Silva");
    expect(first).toHaveTextContent(/R\$\s?15\.000,00/);
    expect(first).toHaveTextContent("01/03/2027");
    expect(first).toHaveTextContent("Bia");
    expect(second).toHaveTextContent("Sem valor");
  });

  it("coluna vazia diz que está vazia", () => {
    render(<PipelineBoard columns={columns} />);
    expect(within(screen.getByTestId("column-CONTACTED")).getByText("Nenhuma oportunidade.")).toBeInTheDocument();
  });

  it("o selo de etapa mostra o rótulo em português, nunca o código", () => {
    render(<StageBadge stage="PROPOSAL_SENT" />);
    expect(screen.getByText("Proposta enviada")).toBeInTheDocument();
    expect(screen.queryByText("PROPOSAL_SENT")).not.toBeInTheDocument();
  });
});
