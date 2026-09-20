import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_MESSAGE } from "@/components/admin/api";
import { ProposalForm } from "@/components/crm/ProposalForm";
import { navigateToDocument } from "@/lib/offline/navigate";

vi.mock("@/lib/offline/navigate", () => ({ navigateToDocument: vi.fn() }));

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const fetchMock = vi.fn();
const OPP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SOURCE = "1a8fad5b-d9cb-469f-a165-70867728950e";

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.mocked(navigateToDocument).mockClear();
  vi.unstubAllGlobals();
});

const fillItem = async (user: ReturnType<typeof userEvent.setup>, n: number, description: string, quantity: string, price: string) => {
  await user.type(screen.getByLabelText(`Descrição do item ${n}`), description);
  await user.clear(screen.getByLabelText(`Quantidade do item ${n}`));
  await user.type(screen.getByLabelText(`Quantidade do item ${n}`), quantity);
  await user.type(screen.getByLabelText(`Preço unitário do item ${n}`), price);
};
const submit = (user: ReturnType<typeof userEvent.setup>, label = "Criar rascunho") => user.click(screen.getByRole("button", { name: label }));
const money = (text: string) => new RegExp(`R\\$\\s${text.replace(/\./g, "\\.")}`);

describe("ProposalForm — criar", () => {
  it("manda os preços em CENTAVOS inteiros, sem total nenhum, e leva para a proposta criada", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { proposal: { id: "p-1" } }));
    render(<ProposalForm mode="create" opportunityId={OPP} cancelHref="/x" />);

    await fillItem(user, 1, "Som e iluminação", "2", "5.000,00");
    await user.type(screen.getByLabelText(/Desconto/), "500,00");
    fireEvent.change(screen.getByLabelText("Válida até"), { target: { value: "2027-01-31" } });
    await user.type(screen.getByLabelText(/Condições e observações/), "Pagamento em 3x");
    await submit(user);

    await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith("/comercial/propostas/p-1"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/comercial/oportunidades/${OPP}/propostas`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      items: [{ description: "Som e iluminação", quantity: 2, unitPriceCents: 500_000 }],
      discountCents: 50_000,
      validUntil: "2027-01-31",
      notes: "Pagamento em 3x",
      copiedFromProposalId: null,
    });
  });

  it("os totais aparecem ENQUANTO se digita, pela mesma conta do servidor", async () => {
    const user = userEvent.setup();
    render(<ProposalForm mode="create" opportunityId={OPP} cancelHref="/x" />);

    await fillItem(user, 1, "Som", "2", "5.000,00");
    await user.click(screen.getByRole("button", { name: "Adicionar item" }));
    await fillItem(user, 2, "Palco", "1", "1.500,00");
    await user.type(screen.getByLabelText(/Desconto/), "500,00");

    expect(screen.getByTestId("line-total-1")).toHaveTextContent(money("10.000,00"));
    expect(screen.getByTestId("line-total-2")).toHaveTextContent(money("1.500,00"));
    expect(screen.getByTestId("form-subtotal")).toHaveTextContent(money("11.500,00"));
    expect(screen.getByTestId("form-discount")).toHaveTextContent(money("500,00"));
    expect(screen.getByTestId("form-total")).toHaveTextContent(money("11.000,00"));
  });

  it("adicionar e remover itens; o último item não se remove", async () => {
    const user = userEvent.setup();
    render(<ProposalForm mode="create" opportunityId={OPP} cancelHref="/x" />);

    expect(screen.getByRole("button", { name: "Remover item 1" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Adicionar item" }));
    expect(screen.getAllByTestId("proposal-form-row")).toHaveLength(2);
    await user.type(screen.getByLabelText("Descrição do item 2"), "Segundo");
    await user.click(screen.getByRole("button", { name: "Remover item 1" }));

    expect(screen.getAllByTestId("proposal-form-row")).toHaveLength(1);
    expect(screen.getByLabelText("Descrição do item 1")).toHaveValue("Segundo");
  });

  it("partindo de uma versão anterior: já vem preenchida (preço com máscara) e registra a origem", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { proposal: { id: "p-2" } }));
    render(
      <ProposalForm
        mode="create"
        opportunityId={OPP}
        copiedFromProposalId={SOURCE}
        initial={{ items: [{ description: "Som", quantity: 3, unitPriceCents: 150_050 }], discountCents: 0, validUntil: null, notes: "Condições" }}
        cancelHref="/x"
      />
    );

    expect(screen.getByLabelText("Descrição do item 1")).toHaveValue("Som");
    expect(screen.getByLabelText("Quantidade do item 1")).toHaveValue("3");
    expect(screen.getByLabelText("Preço unitário do item 1")).toHaveValue("1.500,50");
    await submit(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ copiedFromProposalId: SOURCE, notes: "Condições", validUntil: null });
  });

  describe("valida antes de ir à rede", () => {
    it("preço em branco ou fora do formato: o erro aparece NO item", async () => {
      const user = userEvent.setup();
      render(<ProposalForm mode="create" opportunityId={OPP} cancelHref="/x" />);

      await user.type(screen.getByLabelText("Descrição do item 1"), "Som");
      await submit(user);
      expect(await screen.findByText("Item 1: Informe o preço do item.")).toBeInTheDocument();

      await user.type(screen.getByLabelText("Preço unitário do item 1"), "1.5");
      await submit(user);
      expect(await screen.findByText(/Item 1: Informe o preço como 1\.500,00/)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("quantidade fracionada ou zero é recusada", async () => {
      const user = userEvent.setup();
      render(<ProposalForm mode="create" opportunityId={OPP} cancelHref="/x" />);

      await fillItem(user, 1, "Som", "2,5", "100,00");
      await submit(user);
      expect(await screen.findByText("Item 1: Informe a quantidade como um número inteiro.")).toBeInTheDocument();

      await user.clear(screen.getByLabelText("Quantidade do item 1"));
      await user.type(screen.getByLabelText("Quantidade do item 1"), "0");
      await submit(user);
      expect(await screen.findByText("Item 1: A quantidade mínima é 1.")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("descrição curta e desconto maior que o subtotal", async () => {
      const user = userEvent.setup();
      render(<ProposalForm mode="create" opportunityId={OPP} cancelHref="/x" />);

      await fillItem(user, 1, "A", "1", "100,00");
      await user.type(screen.getByLabelText(/Desconto/), "500,00");
      await submit(user);

      expect(await screen.findByText("Item 1: Descreva o item.")).toBeInTheDocument();
      expect(screen.getByText("O desconto não pode ser maior que o subtotal.")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("já existe um rascunho (409): mostra a mensagem do servidor e mantém o que foi digitado", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "Já existe um rascunho (v2) desta oportunidade." }));
    render(<ProposalForm mode="create" opportunityId={OPP} cancelHref="/x" />);

    await fillItem(user, 1, "Som", "1", "100,00");
    await submit(user);

    expect(await screen.findByText(/Já existe um rascunho \(v2\)/)).toBeInTheDocument();
    expect(navigateToDocument).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Carregar os dados atuais" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Descrição do item 1")).toHaveValue("Som");
  });

  it("sem conexão, diz que exige internet e mantém o que foi digitado", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ProposalForm mode="create" opportunityId={OPP} cancelHref="/x" />);

    await fillItem(user, 1, "Som", "1", "100,00");
    await submit(user);

    expect(await screen.findByText(OFFLINE_MESSAGE)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Descrição do item 1")).toHaveValue("Som");
  });
});

describe("ProposalForm — editar o rascunho", () => {
  const initial = {
    items: [
      { description: "Som e iluminação", quantity: 2, unitPriceCents: 500_000 },
      { description: "Equipe de palco", quantity: 1, unitPriceCents: 150_000 },
    ],
    discountCents: 50_000,
    validUntil: "2027-01-31",
    notes: null,
  };
  const renderEdit = () => render(<ProposalForm mode="edit" opportunityId={OPP} proposalId="p-9" version={4} initial={initial} cancelHref="/comercial/propostas/p-9" />);

  it("abre com os dados atuais e os totais já calculados", () => {
    renderEdit();

    expect(screen.getByLabelText("Descrição do item 2")).toHaveValue("Equipe de palco");
    expect(screen.getByLabelText("Preço unitário do item 1")).toHaveValue("5.000,00");
    expect(screen.getByLabelText(/Desconto/)).toHaveValue("500,00");
    expect(screen.getByLabelText("Válida até")).toHaveValue("2027-01-31");
    expect(screen.getByTestId("form-total")).toHaveTextContent(money("11.000,00"));
  });

  it("salva por PATCH com a versão que viu", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { proposal: { id: "p-9" } }));
    renderEdit();

    await user.click(screen.getByRole("button", { name: "Remover item 2" }));
    await submit(user, "Salvar rascunho");

    await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith("/comercial/propostas/p-9"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/comercial/propostas/p-9");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      items: [{ description: "Som e iluminação", quantity: 2, unitPriceCents: 500_000 }],
      discountCents: 50_000,
      validUntil: "2027-01-31",
      notes: null,
      baseVersion: 4,
    });
  });

  it("se outra pessoa mexeu antes (409), oferece carregar os dados atuais em vez de sobrescrever", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "Esta proposta foi alterada por outra pessoa enquanto você olhava." }));
    renderEdit();

    await submit(user, "Salvar rascunho");

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/alterada por outra pessoa/)).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Carregar os dados atuais" })).toBeInTheDocument();
    expect(navigateToDocument).not.toHaveBeenCalled();
  });
});
