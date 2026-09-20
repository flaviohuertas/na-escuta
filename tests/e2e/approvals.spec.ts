import { expect, test, type Browser, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

const FIELD_STAFF_EMAIL = "equipe@naescuta.com.br"; // criado pelo seed: equipe de campo
const FIELD_STAFF_NAME = "Pessoa da Equipe (demo)";

async function newDevice(browser: Browser) {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

/**
 * Um evento novo, com a titular (gestora, quem o criou) e a pessoa da equipe de campo com acesso —
 * pelo caminho real das telas. Evento próprio de cada teste: o do seed é aberto pelos outros specs.
 */
async function eventWithFieldStaff(browser: Browser, label: string) {
  const eventName = `${label} ${Date.now()}`;
  const manager = await newDevice(browser);
  await login(manager.page);
  await manager.page.goto("/eventos/novo");
  await manager.page.getByLabel("Nome do evento").fill(eventName);
  await manager.page.getByLabel("Início").fill("2026-12-01T18:00");
  await manager.page.getByLabel("Término").fill("2026-12-01T23:00");
  await manager.page.getByRole("button", { name: "Criar evento" }).click();
  await manager.page.waitForURL(/\/eventos\/(?!novo)[^/]+$/);
  const eventUrl = manager.page.url();
  const eventId = new URL(eventUrl).pathname.split("/").pop()!;

  await manager.page.goto(`${eventUrl}/acessos`);
  const select = manager.page.getByLabel("Pessoa", { exact: true });
  await select.selectOption(await select.locator("option", { hasText: FIELD_STAFF_NAME }).getAttribute("value"));
  await manager.page.getByRole("button", { name: "Dar acesso" }).click();
  await expect(manager.page.getByRole("main").getByRole("status")).toContainText("Acesso concedido.");

  const field = await newDevice(browser);
  await login(field.page, FIELD_STAFF_EMAIL);
  return { eventName, eventUrl, eventId, manager, field };
}

/** A equipe de campo propõe pelo formulário; termina na lista de aprovações. */
async function propose(field: Page, eventName: string, changes: { name?: string; location?: string; reason?: string }) {
  await field.goto("/eventos");
  await field.getByRole("link", { name: `Propor alteração em ${eventName}` }).click();
  await field.waitForURL(/\/propor$/);
  if (changes.name) await field.getByLabel("Nome do evento").fill(changes.name);
  if (changes.location) await field.getByLabel("Local").fill(changes.location);
  if (changes.reason) await field.getByLabel(/Por que corrigir/).fill(changes.reason);
  await field.getByRole("button", { name: "Enviar proposta" }).click();
  await field.waitForURL(/\/aprovacoes$/);
}

const pendingCard = (manager: Page, eventName: string) => manager.getByTestId("pending-proposal").filter({ hasText: eventName });
const myCard = (field: Page, eventName: string) => field.getByTestId("my-proposal").filter({ hasText: eventName });

test.describe("Fluxo de aprovação: a equipe de campo propõe, o gestor decide", () => {
  test("propor → aparece para o gestor (com o número no menu) → aprovar aplica no evento e a proposta vira 'Aprovada'", async ({ browser }) => {
    const { eventName, manager, field } = await eventWithFieldStaff(browser, "Evento aprovado");
    const renamed = `${eventName} corrigido`;

    await propose(field.page, eventName, { name: renamed, location: "Praça Central", reason: "O nome oficial mudou" });

    // A pessoa vê a própria proposta, esperando decisão, e o evento NÃO mudou ainda.
    const mine = myCard(field.page, eventName);
    await expect(mine).toContainText("Aguardando decisão");
    await expect(mine).toContainText(renamed);
    await expect(mine).toContainText("Praça Central");
    await expect(mine).toContainText("Motivo: O nome oficial mudou");
    await field.page.goto("/eventos");
    await expect(field.page.getByRole("main").getByText(renamed)).toHaveCount(0);
    // Quem só é da equipe de campo não decide nada: a tela não oferece a fila.
    await field.page.goto("/aprovacoes");
    await expect(field.page.getByRole("heading", { name: "Minhas propostas" })).toBeVisible();
    await expect(field.page.getByRole("heading", { name: /Para decidir/ })).toHaveCount(0);

    // O gestor vê o número no menu e a proposta com o antes e o depois.
    await manager.page.goto("/aprovacoes");
    await expect(manager.page.getByRole("navigation").getByLabel(/\d+ aguardando sua decisão/)).toBeVisible();
    const card = pendingCard(manager.page, eventName);
    await expect(card).toContainText(FIELD_STAFF_NAME);
    await expect(card.locator('[data-field="name"]')).toContainText(renamed);
    await expect(card.locator('[data-field="location"]')).toContainText("Praça Central");

    await card.getByLabel(/Observação/).fill("Confere com o contrato");
    await card.getByRole("button", { name: `Aprovar a proposta de ${FIELD_STAFF_NAME} para ${eventName}` }).click();
    await expect(manager.page.getByRole("main").getByRole("status")).toContainText("aprovada e aplicada ao evento");
    await expect(pendingCard(manager.page, eventName)).toHaveCount(0);
    await expect(manager.page.getByTestId("decided-proposal").filter({ hasText: eventName })).toContainText(/aprovada por/);

    // O evento mudou de verdade — para o gestor e para quem propôs — e a proposta mostra o desfecho.
    await manager.page.goto("/eventos");
    await expect(manager.page.getByRole("main").getByText(renamed, { exact: true })).toBeVisible();
    await field.page.goto("/eventos");
    await expect(field.page.getByRole("main").getByText(renamed, { exact: true })).toBeVisible();
    await field.page.goto("/aprovacoes");
    await expect(myCard(field.page, renamed)).toContainText("Aprovada");
    await expect(myCard(field.page, renamed)).toContainText("Observação: Confere com o contrato");

    await manager.context.close();
    await field.context.close();
  });

  test("rejeitar EXIGE o motivo; a pessoa vê o motivo e o evento não muda", async ({ browser }) => {
    const { eventName, manager, field } = await eventWithFieldStaff(browser, "Evento rejeitado");
    await propose(field.page, eventName, { name: `${eventName} errado` });

    await manager.page.goto("/aprovacoes");
    const card = pendingCard(manager.page, eventName);
    const reject = card.getByRole("button", { name: `Rejeitar a proposta de ${FIELD_STAFF_NAME} para ${eventName}` });

    await reject.click();
    await expect(card.getByTestId("proposal-error")).toHaveText("Explique o motivo da rejeição para quem propôs.");
    await expect(card).toBeVisible(); // nada foi enviado

    await card.getByLabel(/Observação/).fill("O nome só muda depois da assembleia");
    await reject.click();
    await expect(manager.page.getByRole("main").getByRole("status")).toContainText("Proposta rejeitada");

    await field.page.goto("/aprovacoes");
    const mine = myCard(field.page, eventName);
    await expect(mine).toContainText("Rejeitada");
    await expect(mine).toContainText("Motivo: O nome só muda depois da assembleia");
    await manager.page.goto("/eventos");
    await expect(manager.page.getByRole("main").getByText(`${eventName} errado`)).toHaveCount(0);
    await expect(manager.page.getByRole("main").getByText(eventName, { exact: true })).toBeVisible();

    await manager.context.close();
    await field.context.close();
  });

  test("se o gestor edita o MESMO campo depois da proposta, aprovar fica bloqueado (a edição dele não é sobrescrita); rejeitar segue possível", async ({
    browser,
  }) => {
    const { eventName, eventUrl, manager, field } = await eventWithFieldStaff(browser, "Evento em conflito");
    await propose(field.page, eventName, { name: `${eventName} da equipe` });

    // O gestor edita o nome direto, sem olhar a proposta.
    await manager.page.goto(`${eventUrl}/editar`);
    await manager.page.getByLabel("Nome do evento").fill(`${eventName} do gestor`);
    await manager.page.getByRole("button", { name: "Salvar alterações" }).click();
    await manager.page.waitForURL(/\/eventos\/[^/]+$/);

    await manager.page.goto("/aprovacoes");
    const card = pendingCard(manager.page, eventName);
    await expect(card.getByRole("alert")).toContainText(/O evento mudou depois desta proposta \(Nome\)/);
    await expect(card).toContainText(`agora está como ${eventName} do gestor`);
    await expect(card.getByRole("link", { name: "edite o evento direto" })).toBeVisible();
    await expect(card.getByRole("button", { name: /^Aprovar/ })).toBeDisabled();

    await card.getByLabel(/Observação/).fill("O gestor já mudou o nome");
    await card.getByRole("button", { name: /^Rejeitar/ }).click();
    await expect(manager.page.getByRole("main").getByRole("status")).toContainText("Proposta rejeitada");
    // A edição do gestor ficou intacta.
    await manager.page.goto("/eventos");
    await expect(manager.page.getByRole("main").getByText(`${eventName} do gestor`, { exact: true })).toBeVisible();

    await manager.context.close();
    await field.context.close();
  });

  test("permissões: o gestor não propõe (edita direto), a equipe não decide, e a API recusa por conta própria", async ({ browser }) => {
    const { eventName, eventUrl, eventId, manager, field } = await eventWithFieldStaff(browser, "Evento de permissões");

    // Gestor: sem o link de propor no catálogo e, pela URL, a tela explica.
    await manager.page.goto("/eventos");
    await expect(manager.page.getByRole("link", { name: `Propor alteração em ${eventName}` })).toHaveCount(0);
    await manager.page.goto(`${eventUrl}/propor`);
    await expect(manager.page.getByText("Você é gestor deste evento: edite-o direto, sem precisar de aprovação.")).toBeVisible();
    await expect(manager.page.getByRole("button", { name: "Enviar proposta" })).toHaveCount(0);
    const asManager = await manager.page.request.post("/api/aprovacoes", { data: { eventId, changes: { name: "X" } } });
    expect(asManager.status()).toBe(403);

    // Equipe de campo: propõe (a API devolve a proposta), mas não decide, e não muda campo fora da lista.
    const created = await field.page.request.post("/api/aprovacoes", { data: { eventId, changes: { name: `${eventName} v2` } } });
    expect(created.status()).toBe(201);
    const approvalId = ((await created.json()) as { approval: { id: string } }).approval.id;
    const decideAsField = await field.page.request.post(`/api/aprovacoes/${approvalId}/decisao`, { data: { decision: "APPROVE" } });
    expect(decideAsField.status()).toBe(403);
    const sneaky = await field.page.request.post("/api/aprovacoes", { data: { eventId, changes: { name: "Ok", version: 99, companyId: "x" } } });
    expect(sneaky.status()).toBe(422);
    const empty = await field.page.request.post("/api/aprovacoes", { data: { eventId, changes: {} } });
    expect(empty.status()).toBe(422);
    const noReason = await manager.page.request.post(`/api/aprovacoes/${approvalId}/decisao`, { data: { decision: "REJECT" } });
    expect(noReason.status()).toBe(422);
    // O evento continua como estava.
    await field.page.goto("/eventos");
    await expect(field.page.getByRole("main").getByText(eventName, { exact: true })).toBeVisible();

    await manager.context.close();
    await field.context.close();
  });

  test("sem sessão, as rotas de aprovação recusam com 401", async ({ request }) => {
    expect((await request.post("/api/aprovacoes", { data: {} })).status()).toBe(401);
    expect((await request.post("/api/aprovacoes/qualquer-id/decisao", { data: {} })).status()).toBe(401);
  });
});
