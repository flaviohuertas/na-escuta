import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers/auth";
import { FUTURE, confirmAction, createClientViaUi, createDraftViaUi, createOpportunityViaUi } from "./helpers/crm";

const FIELD_STAFF_EMAIL = "equipe@naescuta.com.br"; // criado pelo seed: equipe de campo, fora do comercial

const nav = (page: Page) => page.getByRole("navigation");
const main = (page: Page) => page.getByRole("main");
const money = (text: string) => new RegExp(`R\\$\\s*${text.replace(/\./g, "\\.")}`);

async function fillItem(page: Page, n: number, description: string, quantity: string, price: string) {
  await page.getByLabel(`Descrição do item ${n}`).fill(description);
  await page.getByLabel(`Quantidade do item ${n}`).fill(quantity);
  await page.getByLabel(`Preço unitário do item ${n}`).fill(price);
}

test.describe("Propostas comerciais: rascunho → enviada → nova versão → aceita", () => {
  test("monta a proposta com totais ao vivo, envia, cria a v2 (que substitui a v1) e o aceite leva a oportunidade a Ganho", async ({ page }) => {
    const stamp = Date.now();
    const title = `Proposta E2E ${stamp}`;

    await login(page);
    const clientUrl = await createClientViaUi(page, `Cliente Proposta ${stamp}`);
    const oppUrl = await createOpportunityViaUi(page, clientUrl, title);

    // ---- Sem proposta ainda ----
    await expect(page.getByTestId("proposals-section")).toContainText("Nenhuma proposta ainda");

    // ---- Montar: os totais aparecem enquanto se digita; erro de item aparece no item, sem ir à rede ----
    await page.getByRole("link", { name: "Nova proposta" }).click();
    await page.getByRole("button", { name: "Criar rascunho" }).click();
    await expect(page.getByText("Item 1: Informe o preço do item.")).toBeVisible();
    await expect(page).toHaveURL(/\/propostas\/nova$/);

    await fillItem(page, 1, "Som e iluminação", "2", "5.000,00");
    await page.getByRole("button", { name: "Adicionar item" }).click();
    await fillItem(page, 2, "Equipe de palco", "1", "1.500,00");
    await page.getByLabel(/Desconto/).fill("500,00");
    await expect(page.getByTestId("line-total-1")).toHaveText(money("10.000,00"));
    await expect(page.getByTestId("form-subtotal")).toHaveText(money("11.500,00"));
    await expect(page.getByTestId("form-total")).toHaveText(money("11.000,00"));
    await page.getByLabel("Válida até").fill(FUTURE);
    await page.getByLabel(/Condições e observações/).fill("Pagamento em 3x");
    await page.getByRole("button", { name: "Criar rascunho" }).click();
    await page.waitForURL(/\/comercial\/propostas\/(?!nova)[^/]+$/);
    const v1Url = page.url();

    // ---- O rascunho: o documento tem os itens e os totais que o SERVIDOR calculou ----
    await expect(main(page).getByRole("heading", { level: 1, name: "Proposta v1" })).toBeVisible();
    await expect(page.getByTestId("proposal-item")).toHaveCount(2);
    await expect(page.getByTestId("proposal-subtotal")).toHaveText(money("11.500,00"));
    await expect(page.getByTestId("proposal-total")).toHaveText(money("11.000,00"));
    await expect(main(page)).toContainText("Válida até 31/12/2099");
    await expect(main(page)).toContainText("Pagamento em 3x");
    await expect(page.getByTestId("history-entry").first()).toContainText("Proposta v1 criada.");

    // ---- Editar o rascunho ----
    await page.getByRole("link", { name: "Editar rascunho" }).click();
    await page.getByLabel(/Desconto/).fill("1.000,00");
    await page.getByRole("button", { name: "Salvar rascunho" }).click();
    await page.waitForURL(v1Url);
    await expect(page.getByTestId("proposal-total")).toHaveText(money("10.500,00"));
    await expect(page.getByTestId("history-entry").first()).toContainText("Proposta v1 editada: desconto.");

    // ---- Enviar: só registra; a proposta trava e a oportunidade vai a "Proposta enviada" ----
    await page.getByRole("button", { name: "Marcar como enviada" }).click();
    await expect(page.getByText(/não envia e-mail/)).toBeVisible();
    await page.getByRole("button", { name: "Confirmar envio" }).click();
    await expect(page.getByTestId("history-entry").first()).toContainText("marcada como enviada");
    await expect(page.getByRole("link", { name: "Editar rascunho" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cliente aceitou" })).toBeVisible();
    await page.goto("/comercial");
    await expect(page.getByTestId("column-PROPOSAL_SENT").getByText(title)).toBeVisible();
    await page.goto(oppUrl);
    await expect(page.getByTestId("history-entry").first()).toContainText("Etapa: Novo → Proposta enviada (pela proposta v1)");
    await expect(page.getByTestId("proposal-row")).toHaveCount(1);

    // ---- Nova versão a partir da v1: já vem preenchida; enquanto é rascunho a v1 continua valendo ----
    await page.goto(v1Url);
    await page.getByRole("link", { name: "Criar nova versão a partir desta" }).click();
    await expect(page.getByLabel("Descrição do item 1")).toHaveValue("Som e iluminação");
    await expect(page.getByLabel("Preço unitário do item 1")).toHaveValue("5.000,00");
    await page.getByLabel("Quantidade do item 1").fill("3");
    await page.getByLabel("Válida até").fill(FUTURE);
    await page.getByRole("button", { name: "Criar rascunho" }).click();
    await page.waitForURL(/\/comercial\/propostas\/(?!nova)[^/]+$/);
    const v2Url = page.url();
    await expect(main(page).getByRole("heading", { level: 1, name: "Proposta v2" })).toBeVisible();
    await expect(page.getByTestId("history-entry").first()).toContainText("Proposta v2 criada a partir da v1.");

    await page.goto(oppUrl);
    await expect(page.getByTestId("proposal-row")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Nova proposta" })).toHaveCount(0); // já há um rascunho
    await expect(page.getByTestId("proposals-section")).toContainText("Há um rascunho em andamento");

    // ---- Enviar a v2 substitui a v1 ----
    await page.goto(v2Url);
    await confirmAction(page, "Marcar como enviada", "Confirmar envio");
    await expect(page.getByRole("button", { name: "Cliente aceitou" })).toBeVisible();
    await page.getByRole("link", { name: /^v1 · Substituída$/ }).click();
    await expect(page.getByText("Esta versão foi substituída por uma mais nova")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cliente aceitou" })).toHaveCount(0);

    // ---- A lista das enviadas (quem espera resposta) mostra só a v2 desta oportunidade ----
    await page.goto("/comercial/propostas");
    const rows = page.getByTestId("proposal-overview-row").filter({ hasText: title });
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("v2");
    await expect(rows).toContainText("válida até 31/12/2099");

    // ---- Aceitar: a oportunidade vira Ganho, com o motivo no histórico ----
    await page.goto(v2Url);
    await page.getByRole("button", { name: "Cliente aceitou" }).click();
    await page.getByLabel("Observação (opcional)").fill("Aprovado por e-mail");
    await page.getByRole("button", { name: "Confirmar aceite" }).click();
    await expect(main(page).getByRole("status").filter({ hasText: "Aceita pelo cliente" })).toContainText("Aprovado por e-mail");
    await expect(page.getByRole("button", { name: /Cliente (aceitou|recusou)/ })).toHaveCount(0);

    await page.goto(oppUrl);
    await expect(page.getByTestId("history-entry").first()).toContainText("Etapa: Proposta enviada → Ganho (pela proposta v2)");
    await expect(page.getByTestId("convert-section")).toBeVisible(); // ganha, mas o evento ainda é um passo seguinte
    await expect(page.getByRole("link", { name: "Nova proposta" })).toHaveCount(0); // ganha: propostas travadas

    // ---- Na impressão só o documento fica: navegação e botões somem ----
    await page.goto(v2Url);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("article", { name: "Proposta comercial" })).toBeVisible();
    await expect(nav(page)).toBeHidden();
    await expect(page.getByRole("button", { name: "Imprimir / salvar em PDF" })).toBeHidden();
    await page.emulateMedia({ media: "screen" });
    await expect(nav(page)).toBeVisible();
  });

  test("validade vencida trava o envio (e diz por quê); recusar registra o motivo e a oportunidade fica onde está", async ({ page }) => {
    const stamp = Date.now();
    await login(page);
    const clientUrl = await createClientViaUi(page, `Cliente Validade ${stamp}`);
    const oppUrl = await createOpportunityViaUi(page, clientUrl, `Validade ${stamp}`);

    // Um rascunho com a validade no passado não pode ser enviado.
    const draftUrl = await createDraftViaUi(page, oppUrl, "2020-01-01");
    await expect(main(page).getByRole("note")).toContainText("A validade (01/01/2020) já passou");
    await expect(page.getByRole("button", { name: "Marcar como enviada" })).toHaveCount(0);

    // Corrigir a data libera o envio.
    await page.getByRole("link", { name: "Editar rascunho" }).click();
    await page.getByLabel("Válida até").fill(FUTURE);
    await page.getByRole("button", { name: "Salvar rascunho" }).click();
    await page.waitForURL(draftUrl);
    await confirmAction(page, "Marcar como enviada", "Confirmar envio");
    await expect(page.getByRole("button", { name: "Cliente recusou" })).toBeVisible();

    // Recusar: registra o motivo e a oportunidade continua em "Proposta enviada".
    await page.getByRole("button", { name: "Cliente recusou" }).click();
    await page.getByLabel("Motivo da recusa (opcional)").fill("Achou caro");
    await page.getByRole("button", { name: "Confirmar recusa" }).click();
    await expect(main(page).getByRole("status").filter({ hasText: "Recusada pelo cliente" })).toContainText("Achou caro");
    await page.goto("/comercial");
    await expect(page.getByTestId("column-PROPOSAL_SENT").getByText(`Validade ${stamp}`, { exact: true })).toBeVisible();

    // Recusada: dá para criar a próxima versão, partindo dela.
    await page.goto(draftUrl);
    await expect(page.getByRole("link", { name: "Criar nova versão a partir desta" })).toBeVisible();
  });

  test("duas pessoas na mesma proposta: quem age sobre a tela velha é avisado e nada é sobrescrito", async ({ browser }) => {
    const stamp = Date.now();
    const first = await (await browser.newContext()).newPage();
    await login(first);
    const clientUrl = await createClientViaUi(first, `Cliente Concorrente ${stamp}`);
    const oppUrl = await createOpportunityViaUi(first, clientUrl, `Concorrência ${stamp}`);
    const draftUrl = await createDraftViaUi(first, oppUrl);

    // A segunda pessoa abre o rascunho (ainda pode enviar)...
    const second = await (await browser.newContext()).newPage();
    await login(second);
    await second.goto(draftUrl);
    await expect(second.getByRole("button", { name: "Marcar como enviada" })).toBeVisible();

    // ...a primeira envia antes...
    await confirmAction(first, "Marcar como enviada", "Confirmar envio");
    await expect(first.getByRole("button", { name: "Cliente aceitou" })).toBeVisible();

    // ...e a segunda, sobre a tela velha, é recusada com a opção de recarregar.
    await confirmAction(second, "Marcar como enviada", "Confirmar envio");
    await expect(second.getByRole("main").getByRole("alert")).toContainText("não é mais um rascunho");
    await second.getByRole("button", { name: "Carregar a proposta atual" }).click();
    await expect(second.getByRole("button", { name: "Cliente aceitou" })).toBeVisible();

    await first.context().close();
    await second.context().close();
  });

  test("quem não é do comercial não vê as propostas (tela recusa, API devolve 403); sem sessão, 401", async ({ page, request }) => {
    await login(page, FIELD_STAFF_EMAIL);
    await page.goto("/comercial/propostas");
    await expect(page.getByText("Você não tem acesso ao comercial desta empresa.")).toBeVisible();

    const id = "01991b1a-0000-7000-8000-0000000000c1";
    const content = { items: [{ description: "Invasora", quantity: 1, unitPriceCents: 100 }], discountCents: 0, validUntil: null, notes: null };
    // Direto na API, sem passar pela tela: o servidor recusa por conta própria.
    expect((await page.request.post(`/api/comercial/oportunidades/${id}/propostas`, { data: content })).status()).toBe(403);
    expect((await page.request.patch(`/api/comercial/propostas/${id}`, { data: { ...content, baseVersion: 1 } })).status()).toBe(403);
    expect((await page.request.post(`/api/comercial/propostas/${id}/situacao`, { data: { action: "SEND", baseVersion: 1 } })).status()).toBe(403);

    expect((await request.post(`/api/comercial/oportunidades/${id}/propostas`, { data: {} })).status()).toBe(401);
    expect((await request.patch(`/api/comercial/propostas/${id}`, { data: {} })).status()).toBe(401);
    expect((await request.post(`/api/comercial/propostas/${id}/situacao`, { data: {} })).status()).toBe(401);
  });
});
