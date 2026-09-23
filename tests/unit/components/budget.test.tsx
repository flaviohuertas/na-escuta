import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_MESSAGE } from "@/components/admin/api";
import { BudgetForm } from "@/components/crm/BudgetForm";
import { BudgetTable, MarginSummary } from "@/components/crm/BudgetParts";
import { computeBudgetTotals, computeMargin } from "@/lib/domain/budget";
import { navigateToDocument } from "@/lib/offline/navigate";

vi.mock("@/lib/offline/navigate", () => ({ navigateToDocument: vi.fn() }));

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const fetchMock = vi.fn();
const OPP = "0f8fad5b-d9cb-469f-a165-70867728950e";
const BACK = `/comercial/oportunidades/${OPP}/orcamento`;
const money = (text: string) => new RegExp(`R\\$\\s${text.replace(/\./g, "\\.")}`);

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

type User = ReturnType<typeof userEvent.setup>;
async function fillItem(user: User, n: number, values: { category?: string; description: string; quantity: string; cost: string; supplier?: string }) {
  if (values.category) await user.selectOptions(screen.getByLabelText(`Categoria do item ${n}`), values.category);
  await user.type(screen.getByLabelText(`Descrição do item ${n}`), values.description);
  if (values.supplier) await user.type(screen.getByLabelText(`Fornecedor do item ${n}`), values.supplier);
  await user.clear(screen.getByLabelText(`Quantidade do item ${n}`));
  await user.type(screen.getByLabelText(`Quantidade do item ${n}`), values.quantity);
  await user.type(screen.getByLabelText(`Custo unitário do item ${n}`), values.cost);
}
const submit = (user: User) => user.click(screen.getByRole("button", { name: "Salvar orçamento" }));
const renderForm = (props: Partial<React.ComponentProps<typeof BudgetForm>> = {}) =>
  render(<BudgetForm opportunityId={OPP} version={0} revenue={null} cancelHref={BACK} {...props} />);

describe("BudgetForm — montar", () => {
  it("manda os custos em CENTAVOS inteiros, com a versão 0 (ainda não existia), e volta para o orçamento", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { budget: { id: "b-1" } }));
    renderForm();

    await fillItem(user, 1, { category: "AV", description: "Sonorização", quantity: "2", cost: "3.000,00", supplier: "Som Alfa" });
    await user.type(screen.getByLabelText(/Premissas e observações/), "Montagem em 2 dias");
    await submit(user);

    await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith(BACK));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/comercial/oportunidades/${OPP}/orcamento`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      items: [{ category: "AV", description: "Sonorização", quantity: 2, unitCostCents: 300_000, supplier: "Som Alfa", supplierId: null }],
      notes: "Montagem em 2 dias",
      baseVersion: 0,
    });
  });

  it("o custo total e o subtotal de cada categoria aparecem ENQUANTO se digita", async () => {
    const user = userEvent.setup();
    renderForm();

    await fillItem(user, 1, { category: "AV", description: "Som", quantity: "2", cost: "3.000,00" });
    await user.click(screen.getByRole("button", { name: "Adicionar item" }));
    await fillItem(user, 2, { category: "STAFF", description: "Técnicos", quantity: "10", cost: "200,00" });
    await user.click(screen.getByRole("button", { name: "Adicionar item" }));
    await fillItem(user, 3, { category: "AV", description: "Luz", quantity: "1", cost: "500,00" });

    expect(screen.getByTestId("line-total-1")).toHaveTextContent(money("6.000,00"));
    expect(screen.getByTestId("form-subtotal-AV")).toHaveTextContent(money("6.500,00"));
    expect(screen.getByTestId("form-subtotal-STAFF")).toHaveTextContent(money("2.000,00"));
    expect(screen.getByTestId("form-total")).toHaveTextContent(money("8.500,00"));
  });

  it("com receita de referência, mostra a margem prevista (e o prejuízo, quando o custo passa dela)", async () => {
    const user = userEvent.setup();
    renderForm({ revenue: { cents: 1_200_000, label: "Proposta v1 (enviada)" } });

    await fillItem(user, 1, { category: "AV", description: "Som", quantity: "2", cost: "3.000,00" });
    expect(screen.getByTestId("form-margin")).toHaveTextContent(/Margem prevista sobre proposta v1 \(enviada\): R\$\s6\.000,00 \(50,0%\)/);
    expect(screen.getByTestId("form-margin")).not.toHaveTextContent("prejuízo");

    await user.clear(screen.getByLabelText("Custo unitário do item 1"));
    await user.type(screen.getByLabelText("Custo unitário do item 1"), "9.000,00");
    expect(screen.getByTestId("form-margin")).toHaveTextContent(/-R\$\s6\.000,00 \(-50,0%\), prejuízo/);
  });

  it("sem receita de referência não mostra margem", async () => {
    const user = userEvent.setup();
    renderForm();

    await fillItem(user, 1, { category: "AV", description: "Som", quantity: "1", cost: "100,00" });

    expect(screen.queryByTestId("form-margin")).not.toBeInTheDocument();
  });

  it("adicionar e remover itens; o último item não se remove", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByRole("button", { name: "Remover item 1" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Adicionar item" }));
    await user.type(screen.getByLabelText("Descrição do item 2"), "Segundo");
    await user.click(screen.getByRole("button", { name: "Remover item 1" }));

    expect(screen.getAllByTestId("budget-form-row")).toHaveLength(1);
    expect(screen.getByLabelText("Descrição do item 1")).toHaveValue("Segundo");
  });

  describe("valida antes de ir à rede", () => {
    it("categoria não escolhida: o erro aparece NO item", async () => {
      const user = userEvent.setup();
      renderForm();

      await fillItem(user, 1, { description: "Som", quantity: "1", cost: "100,00" });
      await submit(user);

      expect(await screen.findByText("Item 1: Escolha a categoria do item.")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("custo em branco, custo fora do formato e quantidade fracionada", async () => {
      const user = userEvent.setup();
      renderForm();

      await user.selectOptions(screen.getByLabelText("Categoria do item 1"), "AV");
      await user.type(screen.getByLabelText("Descrição do item 1"), "Som");
      await submit(user);
      expect(await screen.findByText("Item 1: Informe o custo do item.")).toBeInTheDocument();

      await user.type(screen.getByLabelText("Custo unitário do item 1"), "3.5");
      await submit(user);
      expect(await screen.findByText(/Item 1: Informe o custo como 3\.000,00/)).toBeInTheDocument();

      await user.clear(screen.getByLabelText("Custo unitário do item 1"));
      await user.type(screen.getByLabelText("Custo unitário do item 1"), "100,00");
      await user.clear(screen.getByLabelText("Quantidade do item 1"));
      await user.type(screen.getByLabelText("Quantidade do item 1"), "2,5");
      await submit(user);
      expect(await screen.findByText("Item 1: Informe a quantidade como um número inteiro.")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("descrição curta aparece no item", async () => {
      const user = userEvent.setup();
      renderForm();

      await fillItem(user, 1, { category: "AV", description: "S", quantity: "1", cost: "100,00" });
      await submit(user);

      expect(await screen.findByText("Item 1: Descreva o item.")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("outra pessoa criou o orçamento antes (409): mostra a mensagem e oferece carregar os dados atuais", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "Este orçamento foi alterado por outra pessoa enquanto você editava." }));
    renderForm();

    await fillItem(user, 1, { category: "AV", description: "Som", quantity: "1", cost: "100,00" });
    await submit(user);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/alterado por outra pessoa/)).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Carregar os dados atuais" })).toBeInTheDocument();
    expect(navigateToDocument).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Descrição do item 1")).toHaveValue("Som");
  });

  it("sem conexão, diz que exige internet e mantém o que foi digitado", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderForm();

    await fillItem(user, 1, { category: "AV", description: "Som", quantity: "1", cost: "100,00" });
    await submit(user);

    expect(await screen.findByText(OFFLINE_MESSAGE)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Descrição do item 1")).toHaveValue("Som");
  });
});

describe("BudgetForm — editar", () => {
  const initial = {
    items: [
      { category: "AV", description: "Sonorização", quantity: 2, unitCostCents: 300_000, supplier: "Som Alfa" },
      { category: "STAFF", description: "Técnicos de palco", quantity: 10, unitCostCents: 20_000, supplier: null },
    ],
    notes: "Premissa",
  };

  it("abre com os dados atuais (custo com máscara) e os totais já calculados", () => {
    renderForm({ version: 3, initial });

    expect(screen.getByLabelText("Categoria do item 1")).toHaveValue("AV");
    expect(screen.getByLabelText("Fornecedor do item 1")).toHaveValue("Som Alfa");
    expect(screen.getByLabelText("Custo unitário do item 1")).toHaveValue("3.000,00");
    expect(screen.getByLabelText("Fornecedor do item 2")).toHaveValue("");
    expect(screen.getByLabelText(/Premissas e observações/)).toHaveValue("Premissa");
    expect(screen.getByTestId("form-total")).toHaveTextContent(money("8.000,00"));
  });

  it("salva por PUT com a versão que viu", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { budget: { id: "b-1" } }));
    renderForm({ version: 3, initial });

    await user.click(screen.getByRole("button", { name: "Remover item 2" }));
    await submit(user);

    await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith(BACK));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
      items: [{ category: "AV", description: "Sonorização", quantity: 2, unitCostCents: 300_000, supplier: "Som Alfa", supplierId: null }],
      notes: "Premissa",
      baseVersion: 3,
    });
  });
});

describe("MarginSummary", () => {
  const revenue = (cents: number, label = "Proposta v2 (enviada)") => ({ kind: "SENT" as const, cents, label, proposalNumber: 2 });

  it("mostra o custo, a receita COM a origem dela e a margem em reais e em %", () => {
    render(<MarginSummary totalCostCents={800_000} revenue={revenue(1_050_000)} margin={computeMargin(1_050_000, 800_000)} hasBudget />);

    expect(screen.getByTestId("budget-cost")).toHaveTextContent(money("8.000,00"));
    expect(screen.getByTestId("budget-revenue")).toHaveTextContent(money("10.500,00"));
    expect(screen.getByTestId("budget-revenue-source")).toHaveTextContent("Proposta v2 (enviada)");
    expect(screen.getByTestId("budget-margin")).toHaveTextContent(/R\$\s2\.500,00\s*\(23,8%\)/);
    expect(screen.queryByTestId("budget-loss")).not.toBeInTheDocument();
  });

  it("prejuízo aparece como prejuízo (nunca escondido)", () => {
    render(<MarginSummary totalCostCents={800_000} revenue={revenue(500_000)} margin={computeMargin(500_000, 800_000)} hasBudget />);

    expect(screen.getByTestId("budget-margin")).toHaveTextContent(/-R\$\s3\.000,00\s*\(-60,0%\)/);
    expect(screen.getByTestId("budget-loss")).toHaveTextContent("Prejuízo");
  });

  it("receita zero: a margem em reais aparece e diz que não há percentual", () => {
    render(<MarginSummary totalCostCents={800_000} revenue={revenue(0)} margin={computeMargin(0, 800_000)} hasBudget />);

    expect(screen.getByTestId("budget-margin")).not.toHaveTextContent("%");
    expect(screen.getByText("Sem percentual: a receita é zero.")).toBeInTheDocument();
  });

  it("sem receita de referência diz o que fazer; sem orçamento diz para montá-lo (e não inventa zero)", () => {
    const { rerender } = render(<MarginSummary totalCostCents={800_000} revenue={null} margin={null} hasBudget />);
    expect(screen.getByTestId("budget-revenue")).toHaveTextContent("—");
    expect(screen.getByTestId("budget-revenue-source")).toHaveTextContent("Sem proposta nem valor estimado.");
    expect(screen.getByTestId("budget-margin")).toHaveTextContent("Defina o valor estimado da oportunidade ou crie uma proposta.");

    rerender(<MarginSummary totalCostCents={0} revenue={revenue(1_000_000)} margin={null} hasBudget={false} />);
    expect(screen.getByTestId("budget-cost")).toHaveTextContent("—");
    expect(screen.getByTestId("budget-margin")).toHaveTextContent("Monte o orçamento para ver a margem.");
  });
});

describe("BudgetTable", () => {
  const items = [
    { id: "i-1", category: "STAFF", description: "Técnicos de palco", quantity: 10, unitCostCents: 20_000, supplier: "Equipe Alfa" },
    { id: "i-2", category: "AV", description: "Sonorização", quantity: 2, unitCostCents: 300_000, supplier: null },
    { id: "i-3", category: "AV", description: "Iluminação", quantity: 1, unitCostCents: 150_000, supplier: null },
  ];

  it("agrupa por categoria (na ordem do orçamento), com o subtotal de cada uma e o custo total", () => {
    render(<BudgetTable items={items} totals={computeBudgetTotals(items)} />);

    const av = screen.getByTestId("category-AV");
    expect(within(av).getByRole("heading", { name: "Som, luz e imagem" })).toBeInTheDocument();
    expect(screen.getByTestId("subtotal-AV")).toHaveTextContent(money("7.500,00"));
    expect(within(av).getAllByTestId("budget-item")).toHaveLength(2);
    expect(screen.getByTestId("subtotal-STAFF")).toHaveTextContent(money("2.000,00"));
    expect(screen.getByTestId("budget-total")).toHaveTextContent(money("9.500,00"));
    // Som, luz e imagem vem antes de Equipe no orçamento, mesmo o item da equipe sendo o primeiro digitado.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Som, luz e imagem", "Equipe e mão de obra"]);
  });

  it("cada linha mostra quantidade, custo unitário, total e o fornecedor (quando há)", () => {
    render(<BudgetTable items={items} totals={computeBudgetTotals(items)} />);

    const staffRow = within(screen.getByTestId("category-STAFF")).getByTestId("budget-item");
    expect(staffRow).toHaveTextContent("Técnicos de palco");
    expect(staffRow).toHaveTextContent("Equipe Alfa");
    expect(staffRow).toHaveTextContent("10");
    expect(staffRow).toHaveTextContent(money("200,00"));
    expect(staffRow).toHaveTextContent(money("2.000,00"));
  });
});
