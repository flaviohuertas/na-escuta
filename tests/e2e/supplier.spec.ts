import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers/auth";
import { convertToEventViaUi, createClientViaUi, createOpportunityViaUi, createPersonViaUi, randomCnpj } from "./helpers/crm";

const FIELD_STAFF_EMAIL = "equipe@naescuta.com.br"; // criado pelo seed: equipe de campo, fora do cadastro

const main = (page: Page) => page.getByRole("main");
const nav = (page: Page) => page.getByRole("navigation");
const money = (text: string) => new RegExp(`R\\$\\s*${text.replace(/\./g, "\\.")}`);

/** Cadastra um fornecedor pela tela e devolve a URL da ficha. */
async function createSupplierViaUi(page: Page, values: { name: string; document?: string; contact?: string; category?: string }) {
  await page.goto("/fornecedores/novo");
  await page.getByLabel("Nome", { exact: true }).fill(values.name);
  if (values.document) await page.getByLabel(/CPF ou CNPJ/).fill(values.document);
  if (values.contact) await page.getByLabel(/Pessoa de contato/).fill(values.contact);
  if (values.category) await page.getByLabel(/Categoria principal/).selectOption(values.category);
  await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
  await page.waitForURL(/\/fornecedores\/(?!novo)[^/]+$/);
  return page.url();
}

test.describe("Fornecedores: cadastro, vínculo com orçamento e lançamentos, e quanto gastamos com cada um", () => {
  test("cadastrar, achar, vincular ao orçamento e ao lançamento, ver o gasto, renomear e arquivar", async ({ page }) => {
    test.slow(); // passeio longo: cadastro, oportunidade, orçamento, conversão em evento e financeiro
    const stamp = Date.now();
    const name = `Som Alfa ${stamp}`;
    const renamed = `Som Alfa Ltda ${stamp}`;
    const cnpj = randomCnpj();

    await login(page);
    await expect(nav(page).getByRole("link", { name: "Fornecedores", exact: true })).toBeVisible();

    // ---- Cadastro: documento errado não entra; o certo entra; repetir o documento é recusado dizendo quem tem ----
    await page.goto("/fornecedores/novo");
    await page.getByLabel("Nome", { exact: true }).fill(name);
    await page.getByLabel(/CPF ou CNPJ/).fill("11.222.333/0001-82"); // dígito verificador errado
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    await expect(page.getByText("CPF ou CNPJ inválido.")).toBeVisible();
    await expect(page).toHaveURL(/\/fornecedores\/novo$/);

    const supplierUrl = await createSupplierViaUi(page, { name, document: cnpj, contact: "Seu Zé", category: "AV" });
    await expect(main(page).getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByTestId("history-entry").first()).toContainText("Fornecedor cadastrado.");

    await page.goto("/fornecedores/novo");
    await page.getByLabel("Nome", { exact: true }).fill(`${name} (de novo)`);
    await page.getByLabel(/CPF ou CNPJ/).fill(cnpj);
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "já está cadastrado para" })).toContainText(name);

    // ---- A busca acha pelo documento (com ou sem máscara), pelo contato e pela categoria ----
    await page.goto(`/fornecedores?q=${cnpj}`);
    await expect(page.getByTestId("supplier-row").filter({ hasText: name })).toBeVisible();
    await page.goto(`/fornecedores?q=${encodeURIComponent("Seu Zé")}&categoria=AV`);
    await expect(page.getByTestId("supplier-row").filter({ hasText: name })).toBeVisible();
    await page.goto(`/fornecedores?q=${cnpj}&categoria=FOOD`);
    await expect(page.getByTestId("supplier-row")).toHaveCount(0);

    // ---- Uma oportunidade com orçamento que CITA o fornecedor do cadastro ----
    const clientUrl = await createClientViaUi(page, `Cliente Fornecedor ${stamp}`);
    const oppUrl = await createOpportunityViaUi(page, clientUrl, `Fornecedor E2E ${stamp}`, { start: "2027-03-01", end: "2027-03-03" });
    await page.goto(`${oppUrl}/orcamento/editar`);
    await page.getByLabel("Categoria do item 1").selectOption("AV");
    await page.getByLabel("Descrição do item 1").fill("Sonorização");
    await page.getByLabel("Fornecedor cadastrado do item 1").selectOption({ label: name });
    await expect(page.getByLabel("Fornecedor do item 1")).toHaveCount(0); // com cadastro, o texto livre some
    await page.getByLabel("Quantidade do item 1").fill("2");
    await page.getByLabel("Custo unitário do item 1").fill("3.000,00");
    await page.getByRole("button", { name: "Salvar orçamento" }).click();
    await page.waitForURL(/\/orcamento$/);
    await expect(page.getByTestId("category-AV").getByTestId("supplier-link")).toHaveText(name);
    await expect(page.getByTestId("category-AV").getByTestId("supplier-link")).toHaveAttribute("href", supplierUrl.replace(/^https?:\/\/[^/]+/, ""));

    // ---- O evento nasce; o lançamento também cita o fornecedor ----
    await convertToEventViaUi(page, oppUrl);
    await page.goto(oppUrl);
    await main(page).getByRole("link", { name: "Ver o financeiro do evento" }).click();
    await page.waitForURL(/\/financeiro\/eventos\/[^/]+$/);
    const financeUrl = page.url();
    await page.getByLabel("Categoria").selectOption("AV");
    await page.getByLabel("Descrição").fill("Sonorização — saldo");
    await page.getByLabel("Valor (R$)").fill("6.500,00");
    await page.getByLabel("Fornecedor cadastrado").selectOption({ label: name });
    await page.getByRole("button", { name: "Lançar custo" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Lançamento salvo." })).toBeVisible();
    await expect(page.getByTestId("expense-row").first().getByTestId("supplier-link")).toHaveText(name);

    // ---- A ficha do fornecedor diz quanto se gastou e quanto se orçou COM ELE (e avisa que passou) ----
    await page.goto(supplierUrl);
    await expect(page.getByTestId("spend-realized")).toHaveText(money("6.500,00"));
    await expect(page.getByTestId("spend-planned")).toHaveText(money("6.000,00"));
    await expect(page.getByTestId("spend-over")).toContainText("Gastou-se mais com este fornecedor do que o orçado");
    await expect(page.getByTestId("spend-events").getByRole("link")).toHaveAttribute("href", financeUrl.replace(/^https?:\/\/[^/]+/, ""));

    // ---- Renomear: o nome nos orçamentos e lançamentos acompanha, e o histórico diz onde ----
    await page.getByLabel("Nome", { exact: true }).fill(renamed);
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(main(page).getByRole("heading", { level: 1, name: renamed })).toBeVisible();
    await expect(page.getByTestId("history-entry").first()).toContainText(`nome (de ${name} para ${renamed}; atualizado em 1 item de orçamento e 1 lançamento)`);
    await page.goto(`${oppUrl}/orcamento`);
    await expect(page.getByTestId("supplier-link")).toHaveText(renamed);
    await page.goto(financeUrl);
    await expect(page.getByTestId("expense-row").first().getByTestId("supplier-link")).toHaveText(renamed);

    // ---- Arquivar: some da lista e das opções NOVAS, mas o que já o cita continua legível e editável ----
    await page.goto(supplierUrl);
    await page.getByRole("button", { name: "Arquivar fornecedor" }).click();
    await page.getByRole("button", { name: "Confirmar arquivamento" }).click();
    await expect(page.getByText("Fornecedor arquivado. Reative-o para editar")).toBeVisible();
    await page.goto(`/fornecedores?q=${cnpj}`);
    await expect(page.getByTestId("supplier-row")).toHaveCount(0);
    await page.goto(`/fornecedores?q=${cnpj}&arquivados=1`);
    await expect(page.getByTestId("supplier-row").filter({ hasText: renamed })).toContainText("Arquivado");

    await page.goto(financeUrl);
    await expect(page.getByLabel("Fornecedor cadastrado").locator("option", { hasText: renamed })).toHaveCount(0); // não recebe vínculo novo
    await expect(page.getByTestId("expense-row").first().getByTestId("supplier-link")).toHaveText(renamed); // o antigo continua
    await page.getByRole("link", { name: "Editar Sonorização — saldo" }).click();
    await page.waitForURL(/\/editar$/);
    await expect(page.getByLabel("Fornecedor cadastrado")).toHaveValue(/.+/); // o vínculo existente aparece escolhido
    await expect(page.getByLabel("Fornecedor cadastrado").locator("option:checked")).toHaveText(`${renamed} (arquivado)`);
    await page.getByLabel("Valor (R$)").fill("6.400,00");
    await page.getByRole("button", { name: "Salvar alterações" }).click(); // editar o resto passa com o vínculo antigo
    await page.waitForURL(financeUrl);
    await expect(page.getByTestId("expense-amount").first()).toHaveText(money("6.400,00"));

    // ---- Reativar: volta às opções ----
    await page.goto(supplierUrl);
    await page.getByRole("button", { name: "Reativar fornecedor" }).click();
    await expect(page.getByText("Fornecedor arquivado. Reative-o para editar")).toHaveCount(0);
    await page.goto(financeUrl);
    await expect(page.getByLabel("Fornecedor cadastrado").locator("option", { hasText: renamed })).toHaveCount(1);
  });

  test("duas pessoas editando o mesmo fornecedor: a segunda a salvar é avisada e não sobrescreve a primeira", async ({ browser }) => {
    const stamp = Date.now();
    const first = await (await browser.newContext()).newPage();
    await login(first);
    const supplierUrl = await createSupplierViaUi(first, { name: `Concorrência ${stamp}` });

    const second = await (await browser.newContext()).newPage();
    await login(second);
    await second.goto(supplierUrl);
    await expect(second.getByLabel("Nome", { exact: true })).toHaveValue(`Concorrência ${stamp}`);

    await first.getByLabel(/Telefone/).fill("(31) 1111-1111");
    await first.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(first.getByTestId("history-entry").first()).toContainText("Editado: telefone.");

    await second.getByLabel(/Telefone/).fill("(31) 2222-2222");
    await second.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(second.getByRole("main").getByRole("alert")).toContainText("alterado por outra pessoa");
    await second.getByRole("button", { name: "Carregar os dados atuais" }).click();
    await expect(second.getByLabel(/Telefone/)).toHaveValue("(31) 1111-1111");

    await first.context().close();
    await second.context().close();
  });

  test("a PRODUÇÃO mantém o cadastro mas não vê dinheiro nenhum; equipe de campo é recusada; sem sessão, 401", async ({ browser, request }) => {
    test.slow();
    const stamp = Date.now();
    const owner = await (await browser.newContext()).newPage();
    await login(owner);
    const producer = await createPersonViaUi(browser, owner, { name: `Produtora Fornecedores ${stamp}`, email: `produtora.forn.${stamp}@naescuta.com.br`, role: "PRODUCER" });

    // A produção tem o menu do cadastro (e do comercial), mas NÃO o do financeiro...
    await expect(nav(producer).getByRole("link", { name: "Fornecedores", exact: true })).toBeVisible();
    await expect(nav(producer).getByRole("link", { name: "Financeiro", exact: true })).toHaveCount(0);
    // ...cadastra um fornecedor e o edita normalmente...
    const supplierUrl = await createSupplierViaUi(producer, { name: `Da produção ${stamp}`, category: "STAFF" });
    await producer.getByLabel(/Telefone/).fill("(31) 3333-3333");
    await producer.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(producer.getByTestId("history-entry").first()).toContainText("Editado: telefone.");
    // ...mas a seção de gasto e orçado NÃO existe para ela, enquanto o titular a vê na mesma ficha.
    await expect(producer.getByTestId("supplier-spend")).toHaveCount(0);
    await expect(main(producer)).not.toContainText("Quanto gastamos");
    await owner.goto(supplierUrl);
    await expect(owner.getByTestId("supplier-spend")).toBeVisible();

    // O financeiro continua fechado para ela (tela e API).
    await producer.goto("/financeiro");
    await expect(producer.getByText("Você não tem acesso ao financeiro desta empresa.")).toBeVisible();

    // Equipe de campo: sem o menu, a tela recusa e a API devolve 403.
    const staff = await (await browser.newContext()).newPage();
    await login(staff, FIELD_STAFF_EMAIL);
    await expect(nav(staff).getByRole("link", { name: "Fornecedores", exact: true })).toHaveCount(0);
    for (const path of ["/fornecedores", "/fornecedores/novo", supplierUrl.replace(/^https?:\/\/[^/]+/, "")]) {
      await staff.goto(path);
      await expect(staff.getByText("Você não tem acesso aos fornecedores desta empresa."), path).toBeVisible();
    }
    const body = { name: "Invasora", kind: "COMPANY", document: null, contactName: null, email: null, phone: null, category: null, notes: null };
    const id = supplierUrl.split("/").pop()!;
    expect((await staff.request.post("/api/fornecedores", { data: body })).status()).toBe(403);
    expect((await staff.request.patch(`/api/fornecedores/${id}`, { data: { ...body, baseVersion: 1 } })).status()).toBe(403);
    expect((await staff.request.post(`/api/fornecedores/${id}/arquivo`, { data: { archived: true, baseVersion: 1 } })).status()).toBe(403);

    // Sem sessão: 401 nas três rotas.
    expect((await request.post("/api/fornecedores", { data: {} })).status()).toBe(401);
    expect((await request.patch(`/api/fornecedores/${id}`, { data: {} })).status()).toBe(401);
    expect((await request.post(`/api/fornecedores/${id}/arquivo`, { data: {} })).status()).toBe(401);

    await owner.context().close();
    await producer.context().close();
    await staff.context().close();
  });
});
