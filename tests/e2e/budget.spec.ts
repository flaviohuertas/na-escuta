import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers/auth";
import { confirmAction, createClientViaUi, createDraftViaUi, createOpportunityViaUi, createPersonViaUi } from "./helpers/crm";

const FIELD_STAFF_EMAIL = "equipe@naescuta.com.br"; // criado pelo seed: equipe de campo, fora do comercial

const main = (page: Page) => page.getByRole("main");
const money = (text: string) => new RegExp(`R\\$\\s*${text.replace(/\./g, "\\.")}`);

async function fillItem(page: Page, n: number, values: { category: string; description: string; quantity: string; cost: string; supplier?: string }) {
  await page.getByLabel(`Categoria do item ${n}`).selectOption(values.category);
  await page.getByLabel(`Descrição do item ${n}`).fill(values.description);
  if (values.supplier) await page.getByLabel(`Fornecedor do item ${n}`).fill(values.supplier);
  await page.getByLabel(`Quantidade do item ${n}`).fill(values.quantity);
  await page.getByLabel(`Custo unitário do item ${n}`).fill(values.cost);
}

test.describe("Orçamento interno: custo por categoria e margem contra a receita mais firme", () => {
  test("monta o orçamento, vê a margem contra a estimativa, depois contra a proposta enviada e aceita — e o prejuízo aparece", async ({ page }) => {
    const stamp = Date.now();
    const title = `Orçamento E2E ${stamp}`;

    await login(page);
    const clientUrl = await createClientViaUi(page, `Cliente Orçamento ${stamp}`);
    const oppUrl = await createOpportunityViaUi(page, clientUrl, title, { value: "15.000,00" });

    // ---- Sem orçamento: a seção diz para montar e mostra de onde vem a receita (uma ESTIMATIVA) ----
    const section = page.getByTestId("budget-section");
    await expect(section).toContainText("Orçamento interno");
    await expect(section.getByTestId("budget-revenue")).toHaveText(money("15.000,00"));
    await expect(section.getByTestId("budget-revenue-source")).toHaveText("Valor estimado da oportunidade");
    await expect(section.getByTestId("budget-margin")).toContainText("Monte o orçamento para ver a margem.");

    // ---- Montar: custo por categoria e margem prevista ao vivo ----
    await section.getByRole("link", { name: "Montar orçamento" }).click();
    await page.waitForURL(/\/orcamento$/);
    await main(page).getByRole("link", { name: "Montar orçamento" }).click();
    await page.waitForURL(/\/orcamento\/editar$/);
    await page.getByRole("button", { name: "Salvar orçamento" }).click();
    await expect(page.getByText("Item 1: Informe o custo do item.")).toBeVisible(); // erro no item, sem ir à rede
    await expect(page).toHaveURL(/\/orcamento\/editar$/);

    await fillItem(page, 1, { category: "AV", description: "Sonorização", quantity: "2", cost: "3.000,00", supplier: "Som Alfa" });
    await page.getByRole("button", { name: "Adicionar item" }).click();
    await fillItem(page, 2, { category: "STAFF", description: "Técnicos de palco", quantity: "10", cost: "200,00" });
    await expect(page.getByTestId("form-subtotal-AV")).toHaveText(money("6.000,00"));
    await expect(page.getByTestId("form-total")).toHaveText(money("8.000,00"));
    await expect(page.getByTestId("form-margin")).toContainText(/valor estimado da oportunidade: R\$\s*7\.000,00 \(46,7%\)/);
    await page.getByLabel(/Premissas e observações/).fill("Montagem em 2 dias");
    await page.getByRole("button", { name: "Salvar orçamento" }).click();
    await page.waitForURL(/\/orcamento$/);

    // ---- O orçamento salvo: subtotais por categoria, custo total, margem, aviso de confidencialidade e histórico ----
    await expect(main(page).getByRole("heading", { level: 1, name: "Orçamento interno" })).toBeVisible();
    await expect(main(page)).toContainText("Confidencial da produtora");
    await expect(page.getByTestId("subtotal-AV")).toHaveText(money("6.000,00"));
    await expect(page.getByTestId("subtotal-STAFF")).toHaveText(money("2.000,00"));
    await expect(page.getByTestId("budget-total")).toHaveText(money("8.000,00"));
    await expect(page.getByTestId("category-AV")).toContainText("Som Alfa");
    await expect(page.getByTestId("budget-margin")).toContainText(/R\$\s*7\.000,00\s*\(46,7%\)/);
    await expect(main(page)).toContainText("Montagem em 2 dias");
    await expect(page.getByTestId("history-entry").first()).toContainText(/Orçamento criado \(custo previsto de R\$\s*8\.000,00\)/);

    // ---- Na oportunidade: resumo e o histórico do orçamento ----
    await page.goto(oppUrl);
    await expect(page.getByTestId("budget-section").getByTestId("budget-cost")).toHaveText(money("8.000,00"));
    await expect(page.getByTestId("history-entry").first()).toContainText("Orçamento criado");

    // ---- A proposta ENVIADA passa a ser a receita de referência (e diz qual) ----
    const proposalUrl = await createDraftViaUi(page, oppUrl); // R$ 11.000,00
    await confirmAction(page, "Marcar como enviada", "Confirmar envio");
    await expect(page.getByRole("button", { name: "Cliente aceitou" })).toBeVisible();
    await page.goto(`${oppUrl}/orcamento`);
    await expect(page.getByTestId("budget-revenue-source")).toHaveText("Proposta v1 (enviada)");
    await expect(page.getByTestId("budget-revenue")).toHaveText(money("11.000,00"));
    await expect(page.getByTestId("budget-margin")).toContainText(/R\$\s*3\.000,00\s*\(27,3%\)/);

    // ---- Editar: custo acima da receita é PREJUÍZO, dito com todas as letras ----
    await page.getByRole("link", { name: "Editar orçamento" }).click();
    await page.waitForURL(/\/orcamento\/editar$/);
    await expect(page.getByLabel("Custo unitário do item 1")).toHaveValue("3.000,00");
    await page.getByLabel("Custo unitário do item 1").fill("9.000,00");
    await expect(page.getByTestId("form-margin")).toContainText("prejuízo");
    await page.getByRole("button", { name: "Salvar orçamento" }).click();
    await page.waitForURL(/\/orcamento$/);
    await expect(page.getByTestId("budget-cost")).toHaveText(money("20.000,00"));
    await expect(page.getByTestId("budget-margin")).toContainText(/-R\$\s*9\.000,00\s*\(-81,8%\)/);
    await expect(page.getByTestId("budget-loss")).toContainText("Prejuízo");
    await expect(page.getByTestId("history-entry").first()).toContainText(/Orçamento editado: itens \(custo de R\$\s*8\.000,00 para R\$\s*20\.000,00\)/);

    // ---- Aceita a proposta: a referência passa a ser a aceita ----
    await page.goto(proposalUrl);
    await confirmAction(page, "Cliente aceitou", "Confirmar aceite");
    await expect(main(page).getByRole("status").filter({ hasText: "Aceita pelo cliente" })).toBeVisible();
    await page.goto(`${oppUrl}/orcamento`);
    await expect(page.getByTestId("budget-revenue-source")).toHaveText("Proposta v1 (aceita)");
  });

  test("duas pessoas montando o primeiro orçamento: a segunda é avisada e não sobrescreve a primeira", async ({ browser }) => {
    const stamp = Date.now();
    const first = await (await browser.newContext()).newPage();
    await login(first);
    const clientUrl = await createClientViaUi(first, `Cliente Orçamento Concorrente ${stamp}`);
    const oppUrl = await createOpportunityViaUi(first, clientUrl, `Concorrência orçamento ${stamp}`);
    const editUrl = `${oppUrl}/orcamento/editar`;

    // A segunda pessoa abre a tela ainda VAZIA...
    const second = await (await browser.newContext()).newPage();
    await login(second);
    await second.goto(editUrl);
    await expect(second.getByLabel("Descrição do item 1")).toHaveValue("");

    // ...a primeira monta e salva antes...
    await first.goto(editUrl);
    await fillItem(first, 1, { category: "VENUE", description: "Locação do espaço da primeira", quantity: "1", cost: "5.000,00" });
    await first.getByRole("button", { name: "Salvar orçamento" }).click();
    await first.waitForURL(/\/orcamento$/);

    // ...e a segunda, sobre a tela vazia, é recusada com a opção de recarregar.
    await fillItem(second, 1, { category: "FOOD", description: "Buffet da segunda", quantity: "1", cost: "1.000,00" });
    await second.getByRole("button", { name: "Salvar orçamento" }).click();
    await expect(second.getByRole("main").getByRole("alert")).toContainText("alterado por outra pessoa");
    await second.getByRole("button", { name: "Carregar os dados atuais" }).click();
    await expect(second.getByLabel("Descrição do item 1")).toHaveValue("Locação do espaço da primeira");

    await first.context().close();
    await second.context().close();
  });

  test("oportunidade perdida trava a edição (a leitura continua); reabrir libera", async ({ page }) => {
    const stamp = Date.now();
    await login(page);
    const clientUrl = await createClientViaUi(page, `Cliente Orçamento Perdido ${stamp}`);
    const oppUrl = await createOpportunityViaUi(page, clientUrl, `Perdida orçamento ${stamp}`);
    await page.goto(`${oppUrl}/orcamento/editar`);
    await fillItem(page, 1, { category: "OTHER", description: "Item qualquer", quantity: "1", cost: "100,00" });
    await page.getByRole("button", { name: "Salvar orçamento" }).click();
    await page.waitForURL(/\/orcamento$/);

    await page.goto(oppUrl);
    await page.getByRole("button", { name: "Mover para Perdido" }).click();
    await page.getByLabel("Por que a oportunidade foi perdida?").fill("Sem orçamento do cliente");
    await page.getByRole("button", { name: "Confirmar perda" }).click();
    await expect(main(page).getByText("Motivo da perda")).toBeVisible();

    await page.goto(`${oppUrl}/orcamento`);
    await expect(main(page).getByRole("status")).toContainText("perdida");
    await expect(page.getByTestId("budget-total")).toHaveText(money("100,00")); // ler continua possível
    await expect(page.getByRole("link", { name: "Editar orçamento" })).toHaveCount(0);
    await page.goto(`${oppUrl}/orcamento/editar`);
    await expect(main(page).getByRole("status")).toContainText("Reabra");
    await expect(page.getByRole("button", { name: "Salvar orçamento" })).toHaveCount(0);

    await page.goto(oppUrl);
    await page.getByRole("button", { name: "Reabrir como Em contato" }).click();
    await expect(main(page).getByText("Motivo da perda")).toHaveCount(0);
    await page.goto(`${oppUrl}/orcamento/editar`);
    await expect(page.getByRole("button", { name: "Salvar orçamento" })).toBeVisible();
  });

  test("a PRODUÇÃO cuida do comercial mas não vê custo nem margem: sem a seção, tela recusa, API 403 e o histórico não traz o orçamento", async ({ browser }) => {
    const stamp = Date.now();
    const name = `Produtora E2E ${stamp}`;
    const email = `produtora.e2e.${stamp}@naescuta.com.br`;

    // ---- Titular: cadastra uma pessoa com o papel de PRODUÇÃO; ela entra, cria a própria senha e trabalha no comercial ----
    const owner = await (await browser.newContext()).newPage();
    await login(owner);
    const producer = await createPersonViaUi(browser, owner, { name, email, role: "PRODUCER" });

    await expect(producer.getByRole("navigation").getByRole("link", { name: "Comercial", exact: true })).toBeVisible();
    const clientUrl = await createClientViaUi(producer, `Cliente da Produtora ${stamp}`);
    const oppUrl = await createOpportunityViaUi(producer, clientUrl, `Da produção ${stamp}`, { value: "15.000,00" });

    // ---- Ela vê a oportunidade e as propostas (o PREÇO é dela), mas a seção do orçamento nem existe ----
    await expect(producer.getByTestId("proposals-section")).toBeVisible();
    await expect(producer.getByRole("link", { name: "Nova proposta" })).toBeVisible();
    await expect(producer.getByTestId("budget-section")).toHaveCount(0);

    // ---- O titular monta o orçamento dessa oportunidade ----
    await owner.goto(`${oppUrl}/orcamento/editar`);
    await fillItem(owner, 1, { category: "AV", description: "Sonorização confidencial", quantity: "2", cost: "3.000,00" });
    await owner.getByRole("button", { name: "Salvar orçamento" }).click();
    await owner.waitForURL(/\/orcamento$/);
    await expect(owner.getByTestId("budget-cost")).toHaveText(money("6.000,00"));

    // ---- Para a produtora nada mudou: sem seção e SEM rastro do custo no histórico ----
    await producer.goto(oppUrl);
    await expect(producer.getByTestId("budget-section")).toHaveCount(0);
    await expect(producer.getByTestId("history-entry")).toHaveCount(1);
    await expect(producer.getByTestId("history-entry").first()).toContainText("Oportunidade criada.");
    await expect(main(producer)).not.toContainText("Orçamento");
    await expect(main(producer)).not.toContainText("Sonorização confidencial");

    // ---- A tela do orçamento (leitura e edição) recusa; a API também, sem passar pela tela ----
    for (const path of [`${oppUrl}/orcamento`, `${oppUrl}/orcamento/editar`]) {
      await producer.goto(path);
      await expect(producer.getByText("Você não tem acesso ao orçamento interno desta empresa."), path).toBeVisible();
      await expect(producer.getByText("Sonorização confidencial"), path).toHaveCount(0);
    }
    const opportunityId = oppUrl.split("/").pop()!;
    const attempt = { items: [{ category: "AV", description: "Invasora", quantity: 1, unitCostCents: 100, supplier: null }], notes: null, baseVersion: 1 };
    expect((await producer.request.put(`/api/comercial/oportunidades/${opportunityId}/orcamento`, { data: attempt })).status()).toBe(403);

    // ---- E o que o titular gravou continua intacto ----
    await owner.reload();
    await expect(owner.getByTestId("budget-cost")).toHaveText(money("6.000,00"));

    await owner.context().close();
    await producer.context().close();
  });

  test("quem não é do comercial não vê o orçamento (tela recusa, API devolve 403); sem sessão, 401", async ({ page, request }) => {
    await login(page, FIELD_STAFF_EMAIL);
    const id = "01991b1a-0000-7000-8000-0000000000c1";
    await page.goto(`/comercial/oportunidades/${id}/orcamento`);
    await expect(page.getByText("Você não tem acesso ao orçamento interno desta empresa.")).toBeVisible();

    const content = { items: [{ category: "AV", description: "Invasora", quantity: 1, unitCostCents: 100, supplier: null }], notes: null, baseVersion: 0 };
    // Direto na API, sem passar pela tela: o servidor recusa por conta própria.
    expect((await page.request.put(`/api/comercial/oportunidades/${id}/orcamento`, { data: content })).status()).toBe(403);
    expect((await request.put(`/api/comercial/oportunidades/${id}/orcamento`, { data: {} })).status()).toBe(401);
  });
});
