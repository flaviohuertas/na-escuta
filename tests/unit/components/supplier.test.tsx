import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_MESSAGE } from "@/components/admin/api";
import { BudgetForm } from "@/components/crm/BudgetForm";
import { BudgetTable } from "@/components/crm/BudgetParts";
import { ExpenseForm } from "@/components/finance/ExpenseForm";
import { ExpenseList } from "@/components/finance/FinanceParts";
import { SupplierArchiveButton } from "@/components/suppliers/SupplierArchiveButton";
import { SupplierForm } from "@/components/suppliers/SupplierForm";
import { SupplierSpendSection } from "@/components/suppliers/SupplierParts";
import { SupplierSelect } from "@/components/suppliers/SupplierSelect";
import { computeBudgetTotals } from "@/lib/domain/budget";
import { navigateToDocument } from "@/lib/offline/navigate";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }), notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/lib/offline/navigate", () => ({ navigateToDocument: vi.fn() }));

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const fetchMock = vi.fn();
const S1 = "0f8fad5b-d9cb-469f-a165-70867728950e";
const S2 = "1a8fad5b-d9cb-469f-a165-70867728950e";
const OPP = "2b8fad5b-d9cb-469f-a165-70867728950e";
const EVENT = "3c8fad5b-d9cb-469f-a165-70867728950e";
const money = (text: string) => new RegExp(`R\\$\\s${text.replace(/\./g, "\\.")}`);
const choices = [
  { id: S1, name: "Som Alfa" },
  { id: S2, name: "Antigo parceiro", archived: true },
];

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

describe("SupplierForm — cadastrar", () => {
  it("cadastra: o que ficou em branco vai como null, o documento vai como digitado (o servidor tira a máscara) e leva para a ficha", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { supplier: { id: "s-1" } }));
    render(<SupplierForm mode="create" />);

    await user.type(screen.getByLabelText("Nome"), "Buffet Sabor");
    await user.type(screen.getByLabelText(/CPF ou CNPJ/), "06.990.590/0001-23");
    await user.type(screen.getByLabelText(/Pessoa de contato/), "Dona Maria");
    await user.selectOptions(screen.getByLabelText(/Categoria principal/), "FOOD");
    await user.click(screen.getByRole("button", { name: "Cadastrar fornecedor" }));

    await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith("/fornecedores/s-1"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/fornecedores");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "Buffet Sabor",
      kind: "COMPANY",
      document: "06.990.590/0001-23",
      contactName: "Dona Maria",
      email: null,
      phone: null,
      category: "FOOD",
      notes: null,
    });
  });

  it("valida antes de ir à rede: nome curto, documento com dígito errado e e-mail inválido aparecem NO campo", async () => {
    const user = userEvent.setup();
    render(<SupplierForm mode="create" />);

    await user.type(screen.getByLabelText("Nome"), "A");
    await user.type(screen.getByLabelText(/CPF ou CNPJ/), "06.990.590/0001-24");
    await user.type(screen.getByLabelText(/E-mail/), "isso-nao-e-email");
    await user.click(screen.getByRole("button", { name: "Cadastrar fornecedor" }));

    expect(await screen.findByText("Informe o nome do fornecedor.")).toBeInTheDocument();
    expect(screen.getByText("CPF ou CNPJ inválido.")).toBeInTheDocument();
    expect(screen.getByText("Informe um e-mail válido.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("documento duplicado (409): mostra a mensagem do servidor — dizendo quem tem — e mantém o que foi digitado", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "O documento 06.990.590/0001-23 já está cadastrado para Buffet Original." }));
    render(<SupplierForm mode="create" />);

    await user.type(screen.getByLabelText("Nome"), "Buffet de novo");
    await user.type(screen.getByLabelText(/CPF ou CNPJ/), "06990590000123");
    await user.click(screen.getByRole("button", { name: "Cadastrar fornecedor" }));

    expect(await screen.findByText(/já está cadastrado para Buffet Original/)).toBeInTheDocument();
    expect(navigateToDocument).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Carregar os dados atuais" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nome")).toHaveValue("Buffet de novo");
  });

  it("sem conexão, diz que exige internet e mantém o que foi digitado", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<SupplierForm mode="create" />);

    await user.type(screen.getByLabelText("Nome"), "Buffet Sabor");
    await user.click(screen.getByRole("button", { name: "Cadastrar fornecedor" }));

    expect(await screen.findByText(OFFLINE_MESSAGE)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nome")).toHaveValue("Buffet Sabor");
  });
});

describe("SupplierForm — editar", () => {
  const initial = {
    id: "s-9",
    name: "Som Alfa",
    kind: "COMPANY" as const,
    document: "06990590000123",
    contactName: "Zé",
    email: "a@alfa.com",
    phone: null,
    category: "AV",
    notes: null,
    version: 4,
  };

  it("abre com os dados atuais (documento com máscara) e salva por PATCH com a versão que viu", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { supplier: { id: "s-9" } }));
    render(<SupplierForm mode="edit" initial={initial} />);

    expect(screen.getByLabelText("Nome")).toHaveValue("Som Alfa");
    expect(screen.getByLabelText(/CPF ou CNPJ/)).toHaveValue("06.990.590/0001-23");
    expect(screen.getByLabelText(/Categoria principal/)).toHaveValue("AV");
    await user.type(screen.getByLabelText(/Telefone/), "(31) 3000-0000");
    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/fornecedores/s-9");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toMatchObject({ name: "Som Alfa", phone: "(31) 3000-0000", category: "AV", baseVersion: 4 });
  });

  it("se outra pessoa mexeu antes (409), oferece carregar os dados atuais em vez de sobrescrever", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "Este fornecedor foi alterado por outra pessoa enquanto você olhava." }));
    render(<SupplierForm mode="edit" initial={initial} />);

    await user.click(screen.getByRole("button", { name: "Salvar alterações" }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/alterado por outra pessoa/)).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Carregar os dados atuais" })).toBeInTheDocument();
    expect(navigateToDocument).not.toHaveBeenCalled();
  });
});

describe("SupplierArchiveButton", () => {
  it("arquivar pede confirmação (dizendo o que muda) e só então envia, com a versão que a pessoa viu", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { supplier: { id: "s-1" } }));
    render(<SupplierArchiveButton supplierId="s-1" version={5} archived={false} />);

    await user.click(screen.getByRole("button", { name: "Arquivar fornecedor" }));
    expect(screen.getByText(/não recebe vínculos novos/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar arquivamento" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/fornecedores/s-1/arquivo");
    expect(JSON.parse(init.body)).toEqual({ archived: true, baseVersion: 5 });
  });

  it("cancelar a confirmação não envia nada; reativar é direto", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SupplierArchiveButton supplierId="s-1" version={5} archived={false} />);
    await user.click(screen.getByRole("button", { name: "Arquivar fornecedor" }));
    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();

    fetchMock.mockReturnValue(respond(200, { supplier: { id: "s-1" } }));
    render(<SupplierArchiveButton supplierId="s-1" version={6} archived />);
    await user.click(screen.getByRole("button", { name: "Reativar fornecedor" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ archived: false, baseVersion: 6 });
  });

  it("se outra pessoa mexeu antes (409), a mensagem aparece e nada é atualizado", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "Este fornecedor foi alterado por outra pessoa enquanto você olhava." }));
    render(<SupplierArchiveButton supplierId="s-1" version={5} archived={false} />);

    await user.click(screen.getByRole("button", { name: "Arquivar fornecedor" }));
    await user.click(screen.getByRole("button", { name: "Confirmar arquivamento" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("alterado por outra pessoa");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("SupplierSelect", () => {
  it("sem nenhum fornecedor cadastrado não aparece (só o texto livre, como antes)", () => {
    const { container } = render(<SupplierSelect label="Fornecedor cadastrado" suppliers={[]} value="" onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("oferece 'Sem cadastro' e os fornecedores, marcando o arquivado", () => {
    render(<SupplierSelect label="Fornecedor cadastrado" suppliers={choices} value="" onChange={() => {}} />);

    const options = within(screen.getByLabelText("Fornecedor cadastrado")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Sem cadastro (digitar o nome)", "Som Alfa", "Antigo parceiro (arquivado)"]);
  });
});

describe("BudgetForm com fornecedores cadastrados", () => {
  const renderBudget = (props: Partial<React.ComponentProps<typeof BudgetForm>> = {}) =>
    render(<BudgetForm opportunityId={OPP} version={0} revenue={null} cancelHref="/x" suppliers={choices} {...props} />);
  const fill = async (user: User) => {
    await user.selectOptions(screen.getByLabelText("Categoria do item 1"), "AV");
    await user.type(screen.getByLabelText("Descrição do item 1"), "Sonorização");
    await user.type(screen.getByLabelText("Custo unitário do item 1"), "3.000,00");
  };

  it("escolher um do cadastro esconde o texto livre e manda o VÍNCULO (e nada do texto)", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { budget: { id: "b-1" } }));
    renderBudget();

    await fill(user);
    await user.type(screen.getByLabelText("Fornecedor do item 1"), "texto que será descartado");
    await user.selectOptions(screen.getByLabelText("Fornecedor cadastrado do item 1"), S1);
    expect(screen.queryByLabelText("Fornecedor do item 1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Salvar orçamento" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).items[0]).toEqual({
      category: "AV",
      description: "Sonorização",
      quantity: 1,
      unitCostCents: 300_000,
      supplier: null,
      supplierId: S1,
    });
  });

  it("'Sem cadastro' devolve o texto livre e manda só o texto (sem vínculo)", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { budget: { id: "b-1" } }));
    renderBudget();

    await fill(user);
    await user.type(screen.getByLabelText("Fornecedor do item 1"), "Fornecedor avulso");
    await user.click(screen.getByRole("button", { name: "Salvar orçamento" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).items[0]).toMatchObject({ supplier: "Fornecedor avulso", supplierId: null });
  });

  it("ao editar, o vínculo que o item já tem aparece escolhido — mesmo com o fornecedor arquivado — e é mantido", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { budget: { id: "b-1" } }));
    renderBudget({ version: 2, initial: { items: [{ category: "AV", description: "Som", quantity: 1, unitCostCents: 100_000, supplier: "Antigo parceiro", supplierId: S2 }], notes: null } });

    expect(screen.getByLabelText("Fornecedor cadastrado do item 1")).toHaveValue(S2);
    expect(screen.queryByLabelText("Fornecedor do item 1")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Salvar orçamento" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).items[0]).toMatchObject({ supplier: null, supplierId: S2 });
  });

  it("sem nenhum fornecedor cadastrado, a tela é a de antes: só o texto livre", () => {
    renderBudget({ suppliers: [] });

    expect(screen.queryByLabelText("Fornecedor cadastrado do item 1")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Fornecedor do item 1")).toBeInTheDocument();
  });
});

describe("ExpenseForm com fornecedores cadastrados", () => {
  const renderExpense = (props: Partial<React.ComponentProps<typeof ExpenseForm>> = {}) =>
    render(<ExpenseForm mode="create" eventId={EVENT} defaultDate="2027-01-08" suppliers={choices} {...props} />);

  it("escolher um do cadastro manda o vínculo; depois de lançar o formulário volta ao 'sem cadastro' (não repete o fornecedor por engano)", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { expense: { id: "e-1" } }));
    renderExpense();

    await user.selectOptions(screen.getByLabelText("Categoria"), "AV");
    await user.type(screen.getByLabelText("Descrição"), "Sonorização");
    await user.type(screen.getByLabelText("Valor (R$)"), "3.000,00");
    await user.selectOptions(screen.getByLabelText("Fornecedor cadastrado"), S1);
    expect(screen.queryByLabelText("Nome do fornecedor (não cadastrado)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Lançar custo" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ supplier: null, supplierId: S1 });
    expect(screen.getByLabelText("Fornecedor cadastrado")).toHaveValue("");
    expect(screen.getByLabelText("Nome do fornecedor (não cadastrado)")).toBeInTheDocument();
  });

  it("sem cadastro, manda o texto digitado e nenhum vínculo", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { expense: { id: "e-1" } }));
    renderExpense();

    await user.selectOptions(screen.getByLabelText("Categoria"), "AV");
    await user.type(screen.getByLabelText("Descrição"), "Som");
    await user.type(screen.getByLabelText("Valor (R$)"), "10,00");
    await user.type(screen.getByLabelText("Nome do fornecedor (não cadastrado)"), "Avulso");
    await user.click(screen.getByRole("button", { name: "Lançar custo" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ supplier: "Avulso", supplierId: null });
  });

  it("fornecedor arquivado (409): a mensagem do servidor aparece e o que foi digitado fica", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "O fornecedor Antigo parceiro está arquivado. Reative-o ou escolha outro." }));
    renderExpense();

    await user.selectOptions(screen.getByLabelText("Categoria"), "AV");
    await user.type(screen.getByLabelText("Descrição"), "Som");
    await user.type(screen.getByLabelText("Valor (R$)"), "10,00");
    await user.selectOptions(screen.getByLabelText("Fornecedor cadastrado"), S2);
    await user.click(screen.getByRole("button", { name: "Lançar custo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("está arquivado");
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Descrição")).toHaveValue("Som");
  });
});

describe("o nome do fornecedor vira link para a ficha quando há vínculo", () => {
  it("no orçamento", () => {
    const items = [
      { id: "i-1", category: "AV", description: "Sonorização", quantity: 1, unitCostCents: 100_000, supplier: "Som Alfa", supplierId: S1 },
      { id: "i-2", category: "AV", description: "Luz", quantity: 1, unitCostCents: 50_000, supplier: "Avulso", supplierId: null },
    ];
    render(<BudgetTable items={items} totals={computeBudgetTotals(items)} />);

    expect(screen.getByRole("link", { name: "Som Alfa" })).toHaveAttribute("href", `/fornecedores/${S1}`);
    expect(screen.getByText("Avulso")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Avulso" })).not.toBeInTheDocument();
  });

  it("nos lançamentos", () => {
    const row = (overrides: Record<string, unknown>) => ({
      id: "e-1",
      category: "AV",
      description: "Sonorização",
      supplier: null,
      supplierId: null,
      amountCents: 100_000,
      expenseDate: new Date("2027-01-08T00:00:00.000Z"),
      notes: null,
      version: 1,
      voidedAt: null,
      voidReason: null,
      ...overrides,
    });
    render(<ExpenseList eventId={EVENT} expenses={[row({ supplier: "Som Alfa", supplierId: S1 }), row({ id: "e-2", description: "Outro", supplier: "Avulso" })]} />);

    expect(screen.getByRole("link", { name: "Som Alfa" })).toHaveAttribute("href", `/fornecedores/${S1}`);
    expect(screen.getByText(/Avulso/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Avulso" })).not.toBeInTheDocument();
  });
});

describe("SupplierSpendSection", () => {
  const group = (id: string, name: string, totalCents: number, count: number) => ({ id, name, totalCents, count });

  it("mostra o gasto e o orçado com a contagem, e os grupos com link para o financeiro do evento e o orçamento da oportunidade", () => {
    render(
      <SupplierSpendSection
        realized={[group("e-1", "Festival de Verão", 500_000, 2)]}
        planned={[group("o-1", "Festival de Verão (oportunidade)", 610_000, 2)]}
        summary={{ realizedTotalCents: 500_000, realizedCount: 2, plannedTotalCents: 610_000, plannedCount: 2, overPlanned: false }}
      />
    );

    expect(screen.getByTestId("spend-realized")).toHaveTextContent(money("5.000,00"));
    expect(screen.getByTestId("supplier-spend")).toHaveTextContent("2 lançamentos");
    expect(screen.getByTestId("spend-planned")).toHaveTextContent(money("6.100,00"));
    // A linha inteira é o link (alvo de 44 px): o nome leva o valor junto.
    expect(screen.getByRole("link", { name: /^Festival de Verão\s*R\$/ })).toHaveAttribute("href", "/financeiro/eventos/e-1");
    expect(screen.getByRole("link", { name: /^Festival de Verão \(oportunidade\)\s*R\$/ })).toHaveAttribute("href", "/comercial/oportunidades/o-1/orcamento");
    expect(screen.queryByTestId("spend-over")).not.toBeInTheDocument();
  });

  it("avisa quando se gastou mais do que o orçado com ele; sem vínculos diz que não há", () => {
    const { unmount } = render(
      <SupplierSpendSection realized={[group("e-1", "Evento", 100_001, 1)]} planned={[group("o-1", "Op", 100_000, 1)]} summary={{ realizedTotalCents: 100_001, realizedCount: 1, plannedTotalCents: 100_000, plannedCount: 1, overPlanned: true }} />
    );
    expect(screen.getByTestId("spend-over")).toHaveTextContent("Gastou-se mais com este fornecedor do que o orçado");
    unmount();

    render(<SupplierSpendSection realized={[]} planned={[]} summary={{ realizedTotalCents: 0, realizedCount: 0, plannedTotalCents: 0, plannedCount: 0, overPlanned: false }} />);
    expect(screen.getByText("Nenhum lançamento com este fornecedor.")).toBeInTheDocument();
    expect(screen.getByText("Nenhum orçamento cita este fornecedor.")).toBeInTheDocument();
    expect(screen.getByTestId("supplier-spend")).toHaveTextContent("0 lançamentos");
  });
});
