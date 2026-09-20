import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_MESSAGE } from "@/components/admin/api";
import { ProposalActions } from "@/components/crm/ProposalActions";
import { ProposalDocument, ProposalStatusBadge, ProposalVersionList } from "@/components/crm/ProposalParts";
import type { ProposalContext } from "@/lib/domain/proposal";
import { navigateToDocument } from "@/lib/offline/navigate";
import type { ProposalRow } from "@/server/crm/proposal.service";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/offline/navigate", () => ({ navigateToDocument: vi.fn() }));

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
  vi.mocked(navigateToDocument).mockClear();
  vi.unstubAllGlobals();
});

const context = (overrides: Partial<ProposalContext> = {}): ProposalContext => ({
  status: "DRAFT",
  oppStage: "NEW",
  hasEvent: false,
  validUntil: "2027-01-31",
  today: "2027-01-05",
  itemCount: 2,
  totalCents: 1_100_000,
  ...overrides,
});
const renderActions = (overrides: Partial<ProposalContext> = {}) =>
  render(<ProposalActions proposalId="p-1" opportunityId="o-1" version={3} context={context(overrides)} />);
const sentUrl = "/api/comercial/propostas/p-1/situacao";

describe("ProposalActions — rascunho", () => {
  it("oferece editar, marcar como enviada e descartar — e nada de aceitar/recusar", () => {
    renderActions();

    expect(screen.getByRole("link", { name: "Editar rascunho" })).toHaveAttribute("href", "/comercial/propostas/p-1/editar");
    expect(screen.getByRole("button", { name: "Marcar como enviada" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descartar rascunho" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cliente/ })).not.toBeInTheDocument();
  });

  it("enviar pede confirmação, diz que só REGISTRA (não envia e-mail) e manda a versão que viu", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { proposal: { id: "p-1" } }));
    renderActions();

    await user.click(screen.getByRole("button", { name: "Marcar como enviada" }));
    expect(screen.getByText(/só REGISTRA que você enviou/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar envio" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(sentUrl);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ action: "SEND", baseVersion: 3, note: null });
  });

  it("cancelar a confirmação não envia nada", async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole("button", { name: "Marcar como enviada" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("proposal-confirm")).not.toBeInTheDocument();
  });

  it("sem validade (ou já vencida) NÃO oferece enviar e explica o que falta", () => {
    const { unmount } = renderActions({ validUntil: null });
    expect(screen.queryByRole("button", { name: "Marcar como enviada" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Defina até quando a proposta vale");
    unmount();

    renderActions({ validUntil: "2027-01-04" });
    expect(screen.queryByRole("button", { name: "Marcar como enviada" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("04/01/2027");
    // Editar continua possível — é assim que se corrige.
    expect(screen.getByRole("link", { name: "Editar rascunho" })).toBeInTheDocument();
  });

  it("oportunidade perdida: só descartar (editar e enviar dependem de reabrir)", () => {
    renderActions({ oppStage: "LOST" });

    expect(screen.queryByRole("link", { name: "Editar rascunho" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como enviada" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descartar rascunho" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Reabra");
  });

  it("descartar pede confirmação e depois volta para a oportunidade", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { proposal: null }));
    renderActions();

    await user.click(screen.getByRole("button", { name: "Descartar rascunho" }));
    expect(screen.getByText(/não pode ser desfeito/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirmar descarte" }));

    await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith("/comercial/oportunidades/o-1"));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ action: "DISCARD", baseVersion: 3, note: null });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("ProposalActions — enviada", () => {
  it("oferece aceitar e recusar (e nada de editar, enviar ou descartar)", () => {
    renderActions({ status: "SENT" });

    expect(screen.getByRole("button", { name: "Cliente aceitou" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cliente recusou" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Marcar como enviada|Descartar/ })).not.toBeInTheDocument();
  });

  it("aceitar avisa que a oportunidade vira Ganho e leva a observação (opcional)", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { proposal: { id: "p-1" } }));
    renderActions({ status: "SENT" });

    await user.click(screen.getByRole("button", { name: "Cliente aceitou" }));
    expect(screen.getByText(/passa para Ganho/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Observação (opcional)"), "Fechado por telefone");
    await user.click(screen.getByRole("button", { name: "Confirmar aceite" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ action: "ACCEPT", baseVersion: 3, note: "Fechado por telefone" });
  });

  it("recusar leva o motivo; a observação em branco vai como null", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { proposal: { id: "p-1" } }));
    renderActions({ status: "SENT" });

    await user.click(screen.getByRole("button", { name: "Cliente recusou" }));
    await user.click(screen.getByRole("button", { name: "Confirmar recusa" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ action: "REJECT", baseVersion: 3, note: null });
  });

  it("a observação de um painel não vaza para o outro", async () => {
    const user = userEvent.setup();
    renderActions({ status: "SENT" });

    await user.click(screen.getByRole("button", { name: "Cliente aceitou" }));
    await user.type(screen.getByLabelText("Observação (opcional)"), "texto do aceite");
    await user.click(screen.getByRole("button", { name: "Cliente recusou" }));

    expect(screen.getByLabelText("Motivo da recusa (opcional)")).toHaveValue("");
  });

  it("validade vencida: não oferece aceitar (explica), mas ainda deixa recusar", () => {
    renderActions({ status: "SENT", validUntil: "2027-01-04" });

    expect(screen.queryByRole("button", { name: "Cliente aceitou" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/venceu em 04\/01\/2027.*nova versão/);
    expect(screen.getByRole("button", { name: "Cliente recusou" })).toBeInTheDocument();
  });

  it("se outra pessoa mexeu primeiro (409), mostra a mensagem, oferece recarregar e NÃO atualiza a tela", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "Esta proposta foi alterada por outra pessoa enquanto você olhava." }));
    renderActions({ status: "SENT" });

    await user.click(screen.getByRole("button", { name: "Cliente aceitou" }));
    await user.click(screen.getByRole("button", { name: "Confirmar aceite" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/alterada por outra pessoa/);
    expect(within(alert).getByRole("button", { name: "Carregar a proposta atual" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sem conexão, diz que exige internet", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderActions({ status: "SENT" });

    await user.click(screen.getByRole("button", { name: "Cliente recusou" }));
    await user.click(screen.getByRole("button", { name: "Confirmar recusa" }));

    expect(await screen.findByText(OFFLINE_MESSAGE)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("ProposalActions — situações finais", () => {
  it.each(["ACCEPTED", "REJECTED", "SUPERSEDED"])("%s: não há o que fazer, nada é renderizado", (status) => {
    const { container } = renderActions({ status });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ProposalStatusBadge e ProposalVersionList", () => {
  it("o selo mostra o rótulo em português (nunca o código) e o aviso de vencida", () => {
    const { rerender } = render(<ProposalStatusBadge status="SENT" />);
    expect(screen.getByText("Enviada")).toBeInTheDocument();
    expect(screen.queryByText("SENT")).not.toBeInTheDocument();
    expect(screen.queryByText("Vencida")).not.toBeInTheDocument();

    rerender(<ProposalStatusBadge status="SENT" expired />);
    expect(screen.getByText("Vencida")).toBeInTheDocument();
  });

  it("cada versão é um link com número, total, validade e situação", () => {
    const row = (overrides: Partial<ProposalRow>): ProposalRow => ({
      id: "p-1",
      number: 1,
      status: "SUPERSEDED",
      totalCents: 1_100_000,
      validUntil: "2027-01-31",
      sentAt: null,
      itemCount: 2,
      expired: false,
      ...overrides,
    });
    render(<ProposalVersionList rows={[row({ id: "p-2", number: 2, status: "DRAFT", validUntil: null }), row({})]} />);

    const [first, second] = screen.getAllByTestId("proposal-row");
    expect(first).toHaveAttribute("href", "/comercial/propostas/p-2");
    expect(first).toHaveTextContent("Proposta v2");
    expect(first).toHaveTextContent("Rascunho");
    expect(first).not.toHaveTextContent("válida até");
    expect(second).toHaveTextContent(/R\$\s11\.000,00/);
    expect(second).toHaveTextContent("válida até 31/01/2027");
    expect(second).toHaveTextContent("Substituída");
  });
});

describe("ProposalDocument — o que o cliente lê e se imprime", () => {
  const data = (overrides: Record<string, unknown> = {}) => ({
    companyName: "Produtora Alfa",
    opportunityTitle: "Festival de Verão",
    client: { name: "Buffet Sabor", document: "11222333000181", email: "contato@sabor.com", phone: null },
    proposal: {
      number: 2,
      status: "SENT" as const,
      notes: "Pagamento em 3x\nSinal de 30%",
      discountCents: 50_000,
      sentAt: new Date("2027-01-05T15:00:00.000Z"),
      items: [
        { id: "i-1", description: "Som e iluminação", quantity: 2, unitPriceCents: 500_000 },
        { id: "i-2", description: "Equipe de palco", quantity: 1, unitPriceCents: 150_000 },
      ],
    },
    validUntil: "2027-01-31",
    ...overrides,
  });

  it("mostra quem propõe, para quem (documento formatado), os itens e os totais", () => {
    render(<ProposalDocument data={data()} />);

    const doc = screen.getByRole("article", { name: "Proposta comercial" });
    expect(doc).toHaveTextContent("Produtora Alfa");
    expect(doc).toHaveTextContent("Festival de Verão");
    expect(doc).toHaveTextContent("Versão 2");
    expect(doc).toHaveTextContent("Válida até 31/01/2027");
    expect(doc).toHaveTextContent("Enviada em 05/01/2027");
    expect(doc).toHaveTextContent("Buffet Sabor");
    expect(doc).toHaveTextContent("11.222.333/0001-81");
    expect(doc).toHaveTextContent("contato@sabor.com");

    const [first, second] = screen.getAllByTestId("proposal-item");
    expect(first).toHaveTextContent("Som e iluminação");
    expect(first).toHaveTextContent(/R\$\s5\.000,00/);
    expect(first).toHaveTextContent(/R\$\s10\.000,00/);
    expect(second).toHaveTextContent(/R\$\s1\.500,00/);
    expect(screen.getByTestId("proposal-subtotal")).toHaveTextContent(/R\$\s11\.500,00/);
    expect(screen.getByTestId("proposal-discount")).toHaveTextContent(/R\$\s500,00/);
    expect(screen.getByTestId("proposal-total")).toHaveTextContent(/R\$\s11\.000,00/);
    expect(within(doc).getByText(/Sinal de 30%/)).toBeInTheDocument();
  });

  it("sem desconto e sem observações, essas linhas não aparecem; rascunho não mostra 'Enviada em'", () => {
    const base = data();
    render(<ProposalDocument data={data({ proposal: { ...base.proposal, discountCents: 0, notes: null, sentAt: null } })} />);

    expect(screen.queryByTestId("proposal-discount")).not.toBeInTheDocument();
    expect(screen.queryByText("Condições e observações")).not.toBeInTheDocument();
    expect(screen.queryByText(/Enviada em/)).not.toBeInTheDocument();
    expect(screen.getByTestId("proposal-total")).toHaveTextContent(/R\$\s11\.500,00/);
  });
});
