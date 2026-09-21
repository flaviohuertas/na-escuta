import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers/auth";
import { confirmAction, convertToEventViaUi, createBudgetViaUi, createClientViaUi, createDraftViaUi, createOpportunityViaUi, createPersonViaUi } from "./helpers/crm";

const main = (page: Page) => page.getByRole("main");
const money = (text: string) => new RegExp(`R\\$\\s*${text.replace(/\./g, "\\.")}`);

async function addExpense(page: Page, values: { category: string; description: string; amount: string; supplier?: string }) {
  await page.getByLabel("Categoria").selectOption(values.category);
  await page.getByLabel("Descrição").fill(values.description);
  await page.getByLabel("Valor (R$)").fill(values.amount);
  if (values.supplier) {
    // Com fornecedores cadastrados na empresa o formulário ganha um seletor; o nome digitado fica no campo de texto.
    const hasRegistry = (await page.getByLabel("Fornecedor cadastrado").count()) > 0;
    await (hasRegistry ? page.getByLabel("Nome do fornecedor (não cadastrado)") : page.getByLabel(/Fornecedor/)).fill(values.supplier);
  }
  await page.getByRole("button", { name: "Lançar custo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Lançamento salvo." })).toBeVisible();
}

/**
 * Uma oportunidade com orçamento (R$ 8.000,00) e proposta ACEITA (R$ 11.000,00), já transformada
 * em evento. Devolve a URL do financeiro desse evento (aberta pelo link da própria oportunidade).
 */
async function eventWithBudgetAndProposal(page: Page, stamp: number, title: string) {
  const clientUrl = await createClientViaUi(page, `Cliente Financeiro ${stamp}`);
  const oppUrl = await createOpportunityViaUi(page, clientUrl, title, { value: "15.000,00", start: "2027-03-01", end: "2027-03-03" });
  await createBudgetViaUi(page, oppUrl);
  const proposalUrl = await createDraftViaUi(page, oppUrl); // R$ 11.000,00
  await confirmAction(page, "Marcar como enviada", "Confirmar envio");
  await expect(page.getByRole("button", { name: "Cliente aceitou" })).toBeVisible();
  await confirmAction(page, "Cliente aceitou", "Confirmar aceite");
  await expect(main(page).getByRole("status").filter({ hasText: "Aceita pelo cliente" })).toBeVisible();
  expect(proposalUrl).toMatch(/\/comercial\/propostas\//);

  const eventId = await convertToEventViaUi(page, oppUrl);
  await page.goto(oppUrl);
  await main(page).getByRole("link", { name: "Ver o financeiro do evento" }).click();
  await page.waitForURL(new RegExp(`/financeiro/eventos/${eventId}$`));
  return { eventId, financeUrl: page.url(), oppUrl };
}

test.describe("Financeiro do evento: custo realizado contra o orçamento previsto", () => {
  test("do evento que nasceu da oportunidade ao lançamento, à comparação, à edição e ao estorno", async ({ page }) => {
    test.slow(); // passeio longo: cliente, oportunidade, orçamento, proposta, conversão e o financeiro
    const stamp = Date.now();
    const title = `Financeiro E2E ${stamp}`;

    await login(page);
    const { financeUrl, eventId } = await eventWithBudgetAndProposal(page, stamp, title);

    // ---- O resumo já traz a receita (dizendo de onde vem), o previsto e a margem, antes de qualquer gasto ----
    await expect(main(page).getByRole("heading", { level: 1, name: title })).toBeVisible(); // o evento herdou o título da oportunidade
    await expect(main(page)).toContainText("Confidencial da produtora");
    await expect(page.getByTestId("finance-revenue")).toHaveText(money("11.000,00"));
    await expect(page.getByTestId("finance-revenue-source")).toHaveText("Proposta v1 (aceita)");
    await expect(page.getByTestId("finance-planned")).toHaveText(money("8.000,00"));
    await expect(page.getByTestId("finance-realized")).toHaveText(money("0,00"));
    await expect(page.getByTestId("finance-planned-margin")).toContainText(/R\$\s*3\.000,00\s*\(27,3%\)/);
    await expect(page.getByTestId("finance-realized-margin")).toContainText(/R\$\s*11\.000,00\s*\(100,0%\)/);
    await expect(page.getByTestId("comparison-AV")).toContainText("Dentro do previsto");
    await expect(main(page)).toContainText("Nenhum custo lançado ainda.");

    // ---- Lançar: o valor entra em centavos, a lista atualiza e o formulário fica pronto para o próximo ----
    await addExpense(page, { category: "AV", description: "Sonorização — sinal e saldo", amount: "6.500,00", supplier: "Som Alfa" });
    await expect(page.getByTestId("expense-row")).toHaveCount(1);
    await expect(page.getByTestId("expense-row").first()).toContainText("Som Alfa");
    await expect(page.getByLabel("Descrição")).toHaveValue("");
    await expect(page.getByTestId("planned-AV")).toHaveText(money("6.000,00"));
    await expect(page.getByTestId("realized-AV")).toContainText(/R\$\s*6\.500,00\s*\(108,3%\)/);
    await expect(page.getByTestId("variance-AV")).toContainText(/\+R\$\s*500,00/);
    await expect(page.getByTestId("comparison-AV")).toContainText("Estourou");

    await addExpense(page, { category: "FOOD", description: "Buffet da equipe", amount: "300,00" });
    await expect(page.getByTestId("comparison-FOOD")).toContainText("Sem previsão");
    await expect(page.getByTestId("finance-realized")).toHaveText(money("6.800,00"));
    await expect(page.getByTestId("finance-consumed")).toContainText("85,0% do previsto");
    await expect(page.getByTestId("finance-realized-margin")).toContainText(/R\$\s*4\.200,00\s*\(38,2%\)/);

    // ---- Valor errado é recusado na tela, sem ir à rede ----
    await page.getByLabel("Categoria").selectOption("STAFF");
    await page.getByLabel("Descrição").fill("Técnicos");
    await page.getByLabel("Valor (R$)").fill("0,00");
    await page.getByRole("button", { name: "Lançar custo" }).click();
    await expect(page.getByText("O valor precisa ser maior que zero.")).toBeVisible();
    await expect(page.getByTestId("expense-row")).toHaveCount(2);

    // ---- Editar o lançamento de som: passa a caber no previsto ----
    await page.getByRole("link", { name: "Editar Sonorização — sinal e saldo" }).click();
    await page.waitForURL(/\/lancamentos\/[^/]+\/editar$/);
    await expect(page.getByLabel("Valor (R$)")).toHaveValue("6.500,00");
    await page.getByLabel("Valor (R$)").fill("5.500,00");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await page.waitForURL(new RegExp(`/financeiro/eventos/${eventId}$`));
    await expect(page.getByTestId("comparison-AV")).toContainText("Dentro do previsto");
    await expect(page.getByTestId("realized-AV")).toContainText(/R\$\s*5\.500,00\s*\(91,7%\)/);
    await expect(page.getByTestId("history-entry").first()).toContainText(/Lançamento editado \(Sonorização — sinal e saldo\): valor \(de R\$\s*6\.500,00 para R\$\s*5\.500,00\)/);

    // ---- Estornar exige o motivo; o lançamento continua na lista, riscado, e sai dos totais ----
    const buffet = page.getByTestId("expense-row").filter({ hasText: "Buffet da equipe" });
    await buffet.getByRole("button", { name: "Estornar Buffet da equipe" }).click();
    await page.getByRole("button", { name: "Confirmar estorno" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Diga por que o lançamento foi estornado." })).toBeVisible();
    await page.getByLabel("Por que estornar Buffet da equipe?").fill("Lançado no evento errado");
    await page.getByRole("button", { name: "Confirmar estorno" }).click();

    await expect(buffet).toHaveAttribute("data-voided", "true");
    await expect(buffet.getByTestId("void-note")).toContainText("Lançado no evento errado");
    await expect(buffet.getByRole("button", { name: /Estornar/ })).toHaveCount(0);
    await expect(buffet.getByRole("link", { name: /Editar/ })).toHaveCount(0);
    await expect(page.getByTestId("finance-realized")).toHaveText(money("5.500,00"));
    await expect(page.getByTestId("comparison-FOOD")).toHaveCount(0); // sem previsão e sem gasto ativo: sai da comparação
    await expect(page.getByTestId("history-entry").first()).toContainText(/Lançamento estornado: Buffet da equipe \(R\$\s*300,00\) — Lançado no evento errado/);
    await expect(page.getByTestId("expense-row")).toHaveCount(2); // nada foi apagado

    // ---- A visão geral traz o evento com o previsto e o lançado; o menu tem o Financeiro ----
    await expect(page.getByRole("navigation").getByRole("link", { name: "Financeiro", exact: true })).toBeVisible();
    expect(financeUrl).toContain(eventId);
    await page.goto("/financeiro");
    const row = page.getByTestId("finance-event-row").filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row.getByTestId("row-planned")).toHaveText(money("8.000,00"));
    await expect(row.getByTestId("row-realized")).toHaveText(money("5.500,00"));
    await expect(row.getByTestId("row-margin")).toContainText(/R\$\s*5\.500,00\s*\(50,0%\)/); // 11.000 − 5.500
  });

  test("duas pessoas no mesmo lançamento: quem edita sobre a tela velha é avisado e nada é sobrescrito", async ({ browser }) => {
    test.slow();
    const stamp = Date.now();
    const first = await (await browser.newContext()).newPage();
    await login(first);
    const { financeUrl } = await eventWithBudgetAndProposal(first, stamp, `Financeiro concorrente ${stamp}`);
    await addExpense(first, { category: "AV", description: "Lançamento disputado", amount: "1.000,00" });
    await first.getByRole("link", { name: "Editar Lançamento disputado" }).click();
    await first.waitForURL(/\/editar$/);
    const editUrl = first.url();

    // A segunda pessoa abre a edição (vê a versão 1)...
    const second = await (await browser.newContext()).newPage();
    await login(second);
    await second.goto(editUrl);
    await expect(second.getByLabel("Valor (R$)")).toHaveValue("1.000,00");

    // ...a primeira salva antes...
    await first.getByLabel("Valor (R$)").fill("1.500,00");
    await first.getByRole("button", { name: "Salvar alterações" }).click();
    await first.waitForURL(financeUrl);

    // ...e a segunda, sobre a versão velha, é recusada com a opção de recarregar.
    await second.getByLabel("Valor (R$)").fill("2.000,00");
    await second.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(second.getByRole("main").getByRole("alert")).toContainText("alterado por outra pessoa");
    await second.getByRole("button", { name: "Carregar os dados atuais" }).click();
    await expect(second.getByLabel("Valor (R$)")).toHaveValue("1.500,00");

    // O que a primeira gravou é o que vale.
    await second.goto(financeUrl);
    await expect(second.getByTestId("expense-row").first()).toContainText(money("1.500,00"));

    await first.context().close();
    await second.context().close();
  });

  test("a PRODUÇÃO cuida do comercial mas não vê o financeiro: sem o menu, sem o link, tela recusa e API 403; sem sessão, 401", async ({ browser, request }) => {
    test.slow();
    const stamp = Date.now();
    const owner = await (await browser.newContext()).newPage();
    await login(owner);
    const { eventId, oppUrl } = await eventWithBudgetAndProposal(owner, stamp, `Financeiro produção ${stamp}`);
    await addExpense(owner, { category: "AV", description: "Custo confidencial", amount: "1.234,00" });

    const producer = await createPersonViaUi(browser, owner, { name: `Produtora Financeiro ${stamp}`, email: `produtora.fin.${stamp}@naescuta.com.br`, role: "PRODUCER" });

    // Sem o menu do financeiro; com o do comercial. E o link do evento, na oportunidade, também não existe para ela.
    await expect(producer.getByRole("navigation").getByRole("link", { name: "Comercial", exact: true })).toBeVisible();
    await expect(producer.getByRole("navigation").getByRole("link", { name: "Financeiro", exact: true })).toHaveCount(0);
    await producer.goto(oppUrl);
    await expect(main(producer).getByText("virou o evento")).toBeVisible();
    await expect(main(producer).getByRole("link", { name: "Ver o financeiro do evento" })).toHaveCount(0);

    // A tela recusa (visão geral, evento e edição) e nada do que o titular lançou vaza.
    for (const path of ["/financeiro", `/financeiro/eventos/${eventId}`]) {
      await producer.goto(path);
      await expect(producer.getByText("Você não tem acesso ao financeiro desta empresa."), path).toBeVisible();
      await expect(producer.getByText("Custo confidencial"), path).toHaveCount(0);
    }

    // Direto na API, sem passar pela tela: o servidor recusa por conta própria.
    const expense = { category: "AV", description: "Invasora", supplier: null, amountCents: 100, expenseDate: "2027-01-08", notes: null };
    expect((await producer.request.post(`/api/financeiro/eventos/${eventId}/lancamentos`, { data: expense })).status()).toBe(403);
    const fakeId = "01991b1a-0000-7000-8000-0000000000c1";
    expect((await producer.request.patch(`/api/financeiro/lancamentos/${fakeId}`, { data: { ...expense, baseVersion: 1 } })).status()).toBe(403);
    expect((await producer.request.post(`/api/financeiro/lancamentos/${fakeId}/estorno`, { data: { reason: "abc", baseVersion: 1 } })).status()).toBe(403);

    // O titular vê tudo intacto.
    await owner.goto(`/financeiro/eventos/${eventId}`);
    await expect(owner.getByTestId("expense-row")).toHaveCount(1);
    await expect(owner.getByTestId("expense-amount").first()).toHaveText(money("1.234,00"));

    // Sem sessão: 401 nas três rotas.
    expect((await request.post(`/api/financeiro/eventos/${eventId}/lancamentos`, { data: {} })).status()).toBe(401);
    expect((await request.patch(`/api/financeiro/lancamentos/${fakeId}`, { data: {} })).status()).toBe(401);
    expect((await request.post(`/api/financeiro/lancamentos/${fakeId}/estorno`, { data: {} })).status()).toBe(401);

    await owner.context().close();
    await producer.context().close();
  });
});
