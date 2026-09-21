import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_MESSAGE } from "@/components/admin/api";
import { ExpenseForm } from "@/components/finance/ExpenseForm";
import { ComparisonTable, ExpenseList, FinanceSummary } from "@/components/finance/FinanceParts";
import { VoidExpenseButton } from "@/components/finance/VoidExpenseButton";
import { compareToBudget } from "@/lib/domain/finance";
import { navigateToDocument } from "@/lib/offline/navigate";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/offline/navigate", () => ({ navigateToDocument: vi.fn() }));

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const fetchMock = vi.fn();
const EVENT = "0f8fad5b-d9cb-469f-a165-70867728950e";
const money = (text: string) => new RegExp(`R\\$\\s${text.replace(/\./g, "\\.")}`);

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

type User = ReturnType<typeof userEvent.setup>;
async function fillCreate(user: User, values: { category?: string; description: string; amount: string; supplier?: string }) {
  if (values.category) await user.selectOptions(screen.getByLabelText("Categoria"), values.category);
  await user.type(screen.getByLabelText("Descrição"), values.description);
  await user.type(screen.getByLabelText("Valor (R$)"), values.amount);
  if (values.supplier) await user.type(screen.getByLabelText(/Fornecedor/), values.supplier);
}

describe("ExpenseForm — lançar", () => {
  it("manda o valor em CENTAVOS inteiros, com a data padrão de hoje, e fica na tela: limpa o que é do lançamento e atualiza a lista", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { expense: { id: "e-1" } }));
    render(<ExpenseForm mode="create" eventId={EVENT} defaultDate="2027-01-08" />);

    await fillCreate(user, { category: "AV", description: "Sonorização — sinal", amount: "3.000,00", supplier: "Som Alfa" });
    await user.click(screen.getByRole("button", { name: "Lançar custo" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/financeiro/eventos/${EVENT}/lancamentos`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ category: "AV", description: "Sonorização — sinal", supplier: "Som Alfa", amountCents: 300_000, expenseDate: "2027-01-08", notes: null });
    expect(await screen.findByRole("status")).toHaveTextContent("Lançamento salvo.");
    // Pronto para o próximo: o que é do lançamento some; categoria e data ficam.
    expect(screen.getByLabelText("Descrição")).toHaveValue("");
    expect(screen.getByLabelText("Valor (R$)")).toHaveValue("");
    expect(screen.getByLabelText("Categoria")).toHaveValue("AV");
    expect(screen.getByLabelText("Data do custo")).toHaveValue("2027-01-08");
    expect(navigateToDocument).not.toHaveBeenCalled();
  });

  describe("valida antes de ir à rede", () => {
    it("valor em branco, valor fora do formato e valor zero", async () => {
      const user = userEvent.setup();
      render(<ExpenseForm mode="create" eventId={EVENT} defaultDate="2027-01-08" />);

      await user.selectOptions(screen.getByLabelText("Categoria"), "AV");
      await user.type(screen.getByLabelText("Descrição"), "Som");
      await user.click(screen.getByRole("button", { name: "Lançar custo" }));
      expect(await screen.findByText("Informe o valor do lançamento.")).toBeInTheDocument();

      await user.type(screen.getByLabelText("Valor (R$)"), "3.5");
      await user.click(screen.getByRole("button", { name: "Lançar custo" }));
      expect(await screen.findByText(/Informe o valor como 3\.000,00/)).toBeInTheDocument();

      await user.clear(screen.getByLabelText("Valor (R$)"));
      await user.type(screen.getByLabelText("Valor (R$)"), "0,00");
      await user.click(screen.getByRole("button", { name: "Lançar custo" }));
      expect(await screen.findByText("O valor precisa ser maior que zero.")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("categoria não escolhida, descrição curta e data vazia aparecem NO campo", async () => {
      const user = userEvent.setup();
      render(<ExpenseForm mode="create" eventId={EVENT} defaultDate="2027-01-08" />);

      await user.type(screen.getByLabelText("Descrição"), "S");
      await user.type(screen.getByLabelText("Valor (R$)"), "10,00");
      await user.clear(screen.getByLabelText("Data do custo"));
      await user.click(screen.getByRole("button", { name: "Lançar custo" }));

      expect(await screen.findByText("Escolha a categoria.")).toBeInTheDocument();
      expect(screen.getByText("Descreva o lançamento.")).toBeInTheDocument();
      expect(screen.getByText("Data inválida.")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("evento que não é desta empresa (404) ou sem permissão (403): mostra a mensagem do servidor e mantém o que foi digitado", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(403, { error: "Você não tem acesso ao financeiro desta empresa." }));
    render(<ExpenseForm mode="create" eventId={EVENT} defaultDate="2027-01-08" />);

    await fillCreate(user, { category: "AV", description: "Som", amount: "10,00" });
    await user.click(screen.getByRole("button", { name: "Lançar custo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Você não tem acesso ao financeiro desta empresa.");
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Descrição")).toHaveValue("Som");
  });

  it("sem conexão, diz que exige internet e mantém o que foi digitado", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ExpenseForm mode="create" eventId={EVENT} defaultDate="2027-01-08" />);

    await fillCreate(user, { category: "AV", description: "Som", amount: "10,00" });
    await user.click(screen.getByRole("button", { name: "Lançar custo" }));

    expect(await screen.findByText(OFFLINE_MESSAGE)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Descrição")).toHaveValue("Som");
  });
});

describe("ExpenseForm — editar", () => {
  const initial = { id: "e-9", category: "FOOD", description: "Buffet", supplier: null, amountCents: 500_000, expenseDate: "2027-01-08", notes: "Sinal", version: 4 };

  it("abre com os dados atuais (valor com máscara) e salva por PATCH com a versão que viu, voltando ao evento", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { expense: { id: "e-9" } }));
    render(<ExpenseForm mode="edit" eventId={EVENT} defaultDate="2027-01-08" initial={initial} />);

    expect(screen.getByLabelText("Categoria")).toHaveValue("FOOD");
    expect(screen.getByLabelText("Valor (R$)")).toHaveValue("5.000,00");
    expect(screen.getByLabelText(/Observações/)).toHaveValue("Sinal");
    await user.clear(screen.getByLabelText("Valor (R$)"));
    await user.type(screen.getByLabelText("Valor (R$)"), "4.500,00");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith(`/financeiro/eventos/${EVENT}`));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/financeiro/lancamentos/e-9");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ category: "FOOD", description: "Buffet", supplier: null, amountCents: 450_000, expenseDate: "2027-01-08", notes: "Sinal", baseVersion: 4 });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("se outra pessoa mexeu antes (409), oferece carregar os dados atuais em vez de sobrescrever", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "Este lançamento foi alterado por outra pessoa enquanto você olhava." }));
    render(<ExpenseForm mode="edit" eventId={EVENT} defaultDate="2027-01-08" initial={initial} />);

    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/alterado por outra pessoa/)).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Carregar os dados atuais" })).toBeInTheDocument();
    expect(navigateToDocument).not.toHaveBeenCalled();
  });

  it("um lançamento que já foi estornado (409) mostra o aviso e NÃO sai da tela", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "Este lançamento foi estornado e não pode mais ser alterado." }));
    render(<ExpenseForm mode="edit" eventId={EVENT} defaultDate="2027-01-08" initial={initial} />);

    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("foi estornado");
    expect(navigateToDocument).not.toHaveBeenCalled();
  });
});

describe("VoidExpenseButton", () => {
  const renderVoid = () => render(<VoidExpenseButton expenseId="e-1" version={3} description="Buffet" />);

  it("estornar pede o MOTIVO: sem ele não envia; com ele, manda a versão que viu e atualiza a lista", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { expense: { id: "e-1" } }));
    renderVoid();

    await user.click(screen.getByRole("button", { name: "Estornar Buffet" }));
    expect(screen.getByText(/Isto não apaga nada/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirmar estorno" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Diga por que o lançamento foi estornado.");
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Por que estornar Buffet?"), "Cliente cancelou");
    await user.click(screen.getByRole("button", { name: "Confirmar estorno" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/financeiro/lancamentos/e-1/estorno");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ reason: "Cliente cancelou", baseVersion: 3 });
  });

  it("cancelar não envia nada e volta ao botão", async () => {
    const user = userEvent.setup();
    renderVoid();

    await user.click(screen.getByRole("button", { name: "Estornar Buffet" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Estornar Buffet" })).toBeInTheDocument();
  });

  it("se outra pessoa mexeu antes (409), mostra a mensagem, oferece recarregar e NÃO atualiza a lista", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "Este lançamento foi alterado por outra pessoa enquanto você olhava." }));
    renderVoid();

    await user.click(screen.getByRole("button", { name: "Estornar Buffet" }));
    await user.type(screen.getByLabelText("Por que estornar Buffet?"), "Errado");
    await user.click(screen.getByRole("button", { name: "Confirmar estorno" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/alterado por outra pessoa/);
    expect(within(alert).getByRole("button", { name: "Carregar os dados atuais" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sem conexão, diz que exige internet", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderVoid();

    await user.click(screen.getByRole("button", { name: "Estornar Buffet" }));
    await user.type(screen.getByLabelText("Por que estornar Buffet?"), "Errado");
    await user.click(screen.getByRole("button", { name: "Confirmar estorno" }));

    expect(await screen.findByText(OFFLINE_MESSAGE)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("FinanceSummary", () => {
  const comparison = compareToBudget([{ category: "AV", subtotalCents: 800_000 }], [{ category: "AV", totalCents: 680_000 }]);
  const revenue = { kind: "ACCEPTED" as const, cents: 1_050_000, label: "Proposta v1 (aceita)", proposalNumber: 1 };

  it("mostra a receita COM a origem, o previsto, o lançado (e quanto do previsto) e as duas margens", () => {
    render(<FinanceSummary comparison={comparison} revenue={revenue} plannedMargin={{ marginCents: 250_000, marginBps: 2381 }} realizedMargin={{ marginCents: 370_000, marginBps: 3524 }} />);

    expect(screen.getByTestId("finance-revenue")).toHaveTextContent(money("10.500,00"));
    expect(screen.getByTestId("finance-revenue-source")).toHaveTextContent("Proposta v1 (aceita)");
    expect(screen.getByTestId("finance-planned")).toHaveTextContent(money("8.000,00"));
    expect(screen.getByTestId("finance-realized")).toHaveTextContent(money("6.800,00"));
    expect(screen.getByTestId("finance-consumed")).toHaveTextContent("85,0% do previsto");
    expect(screen.getByTestId("finance-planned-margin")).toHaveTextContent(/R\$\s2\.500,00\s*\(23,8%\)/);
    expect(screen.getByTestId("finance-realized-margin")).toHaveTextContent(/R\$\s3\.700,00\s*\(35,2%\)/);
    expect(screen.getByText("Parcial: só o custo já lançado.")).toBeInTheDocument();
    expect(screen.queryByTestId("finance-loss")).not.toBeInTheDocument();
  });

  it("prejuízo (custo lançado acima da receita) aparece como prejuízo", () => {
    render(<FinanceSummary comparison={comparison} revenue={revenue} plannedMargin={null} realizedMargin={{ marginCents: -50_000, marginBps: -476 }} />);

    expect(screen.getByTestId("finance-realized-margin")).toHaveTextContent(/-R\$\s500,00\s*\(-4,8%\)/);
    expect(screen.getByTestId("finance-loss")).toHaveTextContent("Prejuízo");
  });

  it("sem orçamento e sem oportunidade de origem: não inventa previsto nem receita", () => {
    render(<FinanceSummary comparison={compareToBudget([], [{ category: "AV", totalCents: 300_000 }])} revenue={null} plannedMargin={null} realizedMargin={null} />);

    expect(screen.getByTestId("finance-revenue")).toHaveTextContent("—");
    expect(screen.getByTestId("finance-revenue-source")).toHaveTextContent("Evento sem oportunidade de origem.");
    expect(screen.getByTestId("finance-planned")).toHaveTextContent("—");
    expect(screen.getByText("Sem orçamento.")).toBeInTheDocument();
    expect(screen.getByTestId("finance-realized")).toHaveTextContent(money("3.000,00"));
    expect(screen.queryByTestId("finance-consumed")).not.toBeInTheDocument();
    expect(screen.getByTestId("finance-planned-margin")).toHaveTextContent("—");
    expect(screen.getByTestId("finance-realized-margin")).toHaveTextContent("—");
  });
});

describe("ComparisonTable", () => {
  it("cada categoria com previsto, lançado (e quanto do previsto), diferença COM SINAL e a situação — e o total", () => {
    const comparison = compareToBudget(
      [
        { category: "AV", subtotalCents: 600_000 },
        { category: "STAFF", subtotalCents: 200_000 },
      ],
      [
        { category: "AV", totalCents: 650_000 },
        { category: "FOOD", totalCents: 30_000 },
      ]
    );
    render(<ComparisonTable comparison={comparison} />);

    const av = screen.getByTestId("comparison-AV");
    expect(within(av).getByText("Som, luz e imagem")).toBeInTheDocument();
    expect(screen.getByTestId("planned-AV")).toHaveTextContent(money("6.000,00"));
    expect(screen.getByTestId("realized-AV")).toHaveTextContent(/R\$\s6\.500,00\s*\(108,3%\)/);
    expect(screen.getByTestId("variance-AV")).toHaveTextContent(/\+R\$\s500,00/);
    expect(within(av).getByText("Estourou")).toBeInTheDocument();
    expect(within(screen.getByTestId("comparison-FOOD")).getByText("Sem previsão")).toBeInTheDocument();
    expect(screen.getByTestId("planned-FOOD")).toHaveTextContent("—");
    expect(screen.getByTestId("variance-STAFF")).toHaveTextContent(/-R\$\s2\.000,00/);
    expect(within(screen.getByTestId("comparison-STAFF")).getByText("Dentro do previsto")).toBeInTheDocument();
    expect(screen.getByTestId("comparison-realized-total")).toHaveTextContent(money("6.800,00"));
  });

  it("sem nada previsto nem lançado diz isso", () => {
    render(<ComparisonTable comparison={compareToBudget([], [])} />);
    expect(screen.getByText("Nada previsto nem lançado ainda.")).toBeInTheDocument();
  });
});

describe("ExpenseList", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "e-1",
    category: "FOOD",
    description: "Buffet",
    supplier: "Buffet Sabor",
    amountCents: 500_000,
    expenseDate: new Date("2027-01-08T00:00:00.000Z"),
    notes: null,
    version: 1,
    voidedAt: null,
    voidReason: null,
    ...overrides,
  });

  it("cada lançamento com a data SEM fuso, a categoria, o fornecedor e o valor; ativo tem editar e estornar", () => {
    render(<ExpenseList eventId={EVENT} expenses={[row()]} />);

    const item = screen.getByTestId("expense-row");
    expect(item).toHaveAttribute("data-voided", "false");
    expect(item).toHaveTextContent("Buffet");
    expect(item).toHaveTextContent("08/01/2027");
    expect(item).toHaveTextContent("Alimentação e bebidas");
    expect(item).toHaveTextContent("Buffet Sabor");
    expect(screen.getByTestId("expense-amount")).toHaveTextContent(money("5.000,00"));
    expect(screen.getByRole("link", { name: "Editar Buffet" })).toHaveAttribute("href", `/financeiro/eventos/${EVENT}/lancamentos/e-1/editar`);
    expect(screen.getByRole("button", { name: "Estornar Buffet" })).toBeInTheDocument();
  });

  it("o estornado continua na lista, riscado, com o motivo — e SEM editar nem estornar de novo", () => {
    render(<ExpenseList eventId={EVENT} expenses={[row({ voidedAt: new Date("2027-01-09T15:00:00.000Z"), voidReason: "Cliente cancelou" })]} />);

    const item = screen.getByTestId("expense-row");
    expect(item).toHaveAttribute("data-voided", "true");
    expect(screen.getByTestId("void-note")).toHaveTextContent("Estornado em 09/01/2027");
    expect(screen.getByTestId("void-note")).toHaveTextContent("Cliente cancelou");
    expect(screen.getByTestId("expense-amount")).toHaveClass("line-through");
    expect(screen.queryByRole("link", { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Estornar/ })).not.toBeInTheDocument();
  });

  it("sem lançamentos diz isso", () => {
    render(<ExpenseList eventId={EVENT} expenses={[]} />);
    expect(screen.getByText("Nenhum custo lançado ainda.")).toBeInTheDocument();
  });
});
