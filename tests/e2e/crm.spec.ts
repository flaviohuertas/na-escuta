import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

const FIELD_STAFF_EMAIL = "equipe@naescuta.com.br"; // criado pelo seed: equipe de campo, fora do comercial

/** Um CNPJ VÁLIDO e diferente a cada execução (o banco acumula entre rodadas e o documento é único por empresa). */
function randomCnpj(): string {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const digit = (digits: number[], weights: number[]) => {
    const rest = digits.reduce((sum, d, i) => sum + d * weights[i]!, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digit([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...base, d1, d2].join("");
}

async function createClientViaUi(page: Page, name: string, document?: string) {
  await page.goto("/comercial/clientes/novo");
  await page.getByLabel("Nome", { exact: true }).fill(name);
  if (document) await page.getByLabel(/CPF ou CNPJ/).fill(document);
  await page.getByRole("button", { name: "Cadastrar cliente" }).click();
  await page.waitForURL(/\/comercial\/clientes\/(?!novo)[^/]+$/);
  return page.url();
}

async function createOpportunityViaUi(page: Page, clientUrl: string, title: string, extra: { value?: string; start?: string; end?: string } = {}) {
  await page.goto(clientUrl);
  await page.getByRole("link", { name: "Nova oportunidade" }).click();
  await page.waitForURL(/\/comercial\/oportunidades\/nova\?clienteId=/);
  await page.getByLabel("Título").fill(title);
  if (extra.value) await page.getByLabel(/Valor estimado/).fill(extra.value);
  if (extra.start) await page.getByLabel(/Início previsto/).fill(extra.start);
  if (extra.end) await page.getByLabel(/Término previsto/).fill(extra.end);
  await page.getByRole("button", { name: "Abrir oportunidade" }).click();
  await page.waitForURL(/\/comercial\/oportunidades\/(?!nova)[^/]+$/);
  return page.url();
}

const nav = (page: Page) => page.getByRole("navigation");
const main = (page: Page) => page.getByRole("main");

test.describe("Comercial (CRM): clientes, funil e a oportunidade que vira evento", () => {
  test("cliente → oportunidade → funil → perder e reabrir → transformar em evento → arquivar", async ({ page }) => {
    const stamp = Date.now();
    const clientName = `Cliente E2E ${stamp}`;
    const title = `Festival ${stamp}`;
    const cnpj = randomCnpj();

    await login(page);
    await nav(page).getByRole("link", { name: "Comercial", exact: true }).click();
    await page.waitForURL(/\/comercial$/);
    await expect(main(page).getByRole("heading", { name: "Comercial" })).toBeVisible();

    // ---- Cliente: documento errado não entra; o certo entra; repetir o documento é recusado dizendo quem é ----
    await page.goto("/comercial/clientes/novo");
    await page.getByLabel("Nome", { exact: true }).fill(clientName);
    await page.getByLabel(/CPF ou CNPJ/).fill("11.222.333/0001-82"); // dígito verificador errado
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await expect(page.getByText("CPF ou CNPJ inválido.")).toBeVisible();
    await expect(page).toHaveURL(/\/comercial\/clientes\/novo$/);

    const clientUrl = await createClientViaUi(page, clientName, cnpj);
    await expect(main(page).getByRole("heading", { name: clientName })).toBeVisible();

    await page.goto("/comercial/clientes/novo");
    await page.getByLabel("Nome", { exact: true }).fill(`${clientName} (de novo)`);
    await page.getByLabel(/CPF ou CNPJ/).fill(cnpj);
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "já está cadastrado para" })).toContainText(clientName);

    // ---- A busca acha o cliente pelo documento, com ou sem máscara ----
    await page.goto(`/comercial/clientes?q=${cnpj}`);
    await expect(page.getByTestId("client-row").filter({ hasText: clientName })).toBeVisible();

    // ---- Oportunidade: valor em reais, datas previstas ----
    const oppUrl = await createOpportunityViaUi(page, clientUrl, title, { value: "15.000,00", start: "2027-03-01", end: "2027-03-03" });
    await expect(main(page).getByRole("heading", { name: title })).toBeVisible();
    await expect(main(page)).toContainText(/R\$\s*15\.000,00/);
    await expect(main(page)).toContainText("01/03/2027");
    await expect(page.getByTestId("history-entry").first()).toContainText("Oportunidade criada.");

    // ---- Funil: aparece na coluna "Novo"; mover para Negociação a leva para a coluna certa ----
    await page.goto("/comercial");
    await expect(page.getByTestId("column-NEW").getByText(title)).toBeVisible();
    await page.goto(oppUrl);
    await page.getByRole("button", { name: "Mover para Negociação" }).click();
    await expect(page.getByTestId("history-entry").first()).toContainText("Etapa: Novo → Negociação");
    await page.goto("/comercial");
    await expect(page.getByTestId("column-NEGOTIATION").getByText(title)).toBeVisible();
    await expect(page.getByTestId("column-NEW").getByText(title)).toHaveCount(0);

    // ---- Uma segunda oportunidade: perder EXIGE o motivo; reabrir volta ao funil ----
    const lostTitle = `Perdida ${stamp}`;
    const lostUrl = await createOpportunityViaUi(page, clientUrl, lostTitle);
    await page.getByRole("button", { name: "Mover para Perdido" }).click();
    await page.getByRole("button", { name: "Confirmar perda" }).click();
    await expect(main(page).getByRole("alert")).toContainText("Diga por que a oportunidade foi perdida.");
    await page.getByLabel("Por que a oportunidade foi perdida?").fill("Foi para a concorrência");
    await page.getByRole("button", { name: "Confirmar perda" }).click();
    await expect(main(page).getByText("Motivo da perda")).toBeVisible();
    await expect(main(page)).toContainText("Foi para a concorrência");
    await expect(page.getByTestId("history-entry").first()).toContainText("motivo: Foi para a concorrência");
    // Ganho ↔ perdido direto não existe: só reabrir.
    await expect(page.getByRole("button", { name: /^Mover para Ganho$/ })).toHaveCount(0);
    await page.goto("/comercial");
    await page.getByTestId("closed-lost").locator("summary").click();
    await expect(page.getByTestId("closed-lost").getByText(lostTitle)).toBeVisible();
    await page.goto(lostUrl);
    await page.getByRole("button", { name: "Reabrir como Em contato" }).click();
    await expect(main(page).getByText("Motivo da perda")).toHaveCount(0);
    await expect(page.getByTestId("history-entry").first()).toContainText("Etapa: Perdido → Em contato");

    // ---- Arquivar o cliente com oportunidade em andamento é recusado ----
    await page.goto(clientUrl);
    await page.getByRole("button", { name: "Arquivar cliente" }).click();
    await page.getByRole("button", { name: "Confirmar arquivamento" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "em andamento" })).toBeVisible();

    // ---- Transformar em evento: nasce o evento, a oportunidade vira ganha e aponta para ele ----
    await page.goto(oppUrl);
    await page.getByTestId("convert-section").locator("summary").click();
    await expect(page.getByLabel("Nome do evento")).toHaveValue(title);
    await expect(page.getByLabel("Início do evento")).toHaveValue("2027-03-01T00:00");
    await page.getByLabel("Término do evento").fill("2027-03-03T22:00");
    await page.getByRole("button", { name: "Criar evento e marcar como ganha" }).click();
    await page.waitForURL(/\/eventos\/(?!novo)[^/]+$/);
    const eventUrl = page.url();

    await page.goto(oppUrl);
    await expect(main(page).getByRole("status").filter({ hasText: "virou o evento" })).toContainText(title);
    await expect(page.getByTestId("history-entry").first()).toContainText("Virou um evento.");
    await expect(page.getByTestId("convert-section")).toHaveCount(0); // já virou evento: não converte de novo
    await expect(page.getByRole("button", { name: /^Reabrir como/ })).toHaveCount(0); // e não reabre
    await page.goto("/eventos");
    await expect(main(page).getByText(title, { exact: true })).toBeVisible();
    await page.goto("/comercial");
    await page.getByTestId("closed-won").locator("summary").click();
    await expect(page.getByTestId("closed-won").getByText(title)).toBeVisible();
    expect(eventUrl).toMatch(/\/eventos\//);

    // ---- Agora, com a outra oportunidade encerrada, o cliente pode ser arquivado — e reativado ----
    await page.goto(lostUrl);
    await page.getByRole("button", { name: "Mover para Perdido" }).click();
    await page.getByLabel("Por que a oportunidade foi perdida?").fill("Desistiu");
    await page.getByRole("button", { name: "Confirmar perda" }).click();
    await expect(main(page).getByText("Motivo da perda")).toBeVisible();

    await page.goto(clientUrl);
    await page.getByRole("button", { name: "Arquivar cliente" }).click();
    await page.getByRole("button", { name: "Confirmar arquivamento" }).click();
    await expect(page.getByText("Cliente arquivado. Reative-o")).toBeVisible();
    await page.goto(`/comercial/clientes?q=${cnpj}`);
    await expect(page.getByTestId("client-row")).toHaveCount(0);
    await page.goto(`/comercial/clientes?q=${cnpj}&arquivados=1`);
    await expect(page.getByTestId("client-row").filter({ hasText: clientName })).toContainText("Arquivado");
    await page.goto(clientUrl);
    await page.getByRole("button", { name: "Reativar cliente" }).click();
    await expect(page.getByText("Cliente arquivado. Reative-o")).toHaveCount(0);
  });

  test("duas pessoas editando a mesma oportunidade: a segunda a salvar é avisada e não sobrescreve a primeira", async ({ browser }) => {
    const stamp = Date.now();
    const first = await (await browser.newContext()).newPage();
    await login(first);
    const clientUrl = await createClientViaUi(first, `Cliente concorrente ${stamp}`);
    const oppUrl = await createOpportunityViaUi(first, clientUrl, `Concorrência ${stamp}`);
    const editUrl = `${oppUrl}/editar`;

    // A segunda pessoa abre a edição (vê a versão 1)...
    const second = await (await browser.newContext()).newPage();
    await login(second);
    await second.goto(editUrl);
    await expect(second.getByLabel("Título")).toHaveValue(`Concorrência ${stamp}`);

    // ...a primeira edita e salva antes...
    await first.goto(editUrl);
    await first.getByLabel("Título").fill(`Título da primeira ${stamp}`);
    await first.getByRole("button", { name: "Salvar alterações" }).click();
    await first.waitForURL(/\/comercial\/oportunidades\/(?!nova)[^/]+$/);

    // ...e a segunda, sobre a versão velha, é recusada com a opção de recarregar.
    await second.getByLabel("Título").fill(`Título da segunda ${stamp}`);
    await second.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(second.getByRole("main").getByRole("alert")).toContainText("alterada por outra pessoa");
    await second.getByRole("button", { name: "Carregar os dados atuais" }).click();
    await expect(second.getByLabel("Título")).toHaveValue(`Título da primeira ${stamp}`);

    await first.context().close();
    await second.context().close();
  });

  test("quem não é do comercial (equipe de campo) não vê o menu, a tela recusa e a API devolve 403", async ({ page }) => {
    await login(page, FIELD_STAFF_EMAIL);

    await expect(nav(page).getByRole("link", { name: "Comercial", exact: true })).toHaveCount(0);
    for (const path of ["/comercial", "/comercial/clientes", "/comercial/clientes/novo", "/comercial/oportunidades/nova"]) {
      await page.goto(path);
      await expect(page.getByText("Você não tem acesso ao comercial desta empresa."), path).toBeVisible();
    }
    // Direto na API, sem passar pela tela: o servidor recusa por conta própria.
    expect((await page.request.post("/api/comercial/clientes", { data: { name: "Invasora" } })).status()).toBe(403);
    expect((await page.request.post("/api/comercial/oportunidades", { data: { clientId: "01991b1a-0000-7000-8000-0000000000c1", title: "Invasora" } })).status()).toBe(403);
  });

  test("sem sessão, as rotas do comercial recusam com 401", async ({ request }) => {
    expect((await request.post("/api/comercial/clientes", { data: {} })).status()).toBe(401);
    expect((await request.patch("/api/comercial/clientes/x", { data: {} })).status()).toBe(401);
    expect((await request.post("/api/comercial/clientes/x/arquivo", { data: {} })).status()).toBe(401);
    expect((await request.post("/api/comercial/oportunidades", { data: {} })).status()).toBe(401);
    expect((await request.patch("/api/comercial/oportunidades/x", { data: {} })).status()).toBe(401);
    expect((await request.post("/api/comercial/oportunidades/x/etapa", { data: {} })).status()).toBe(401);
    expect((await request.post("/api/comercial/oportunidades/x/evento", { data: {} })).status()).toBe(401);
  });
});
