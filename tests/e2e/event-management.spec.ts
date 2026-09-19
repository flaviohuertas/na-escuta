import { expect, test, type Page } from "@playwright/test";
import { login, openFirstEvent } from "./helpers/auth";

const FIELD_STAFF_EMAIL = "equipe@naescuta.com.br"; // criado pelo seed: papel restrito

const uniqueName = (label: string) => `${label} ${Date.now()}`;

/** Preenche e envia "Novo evento"; termina na tela do evento criado. */
async function fillNewEvent(page: Page, name: string) {
  await page.getByLabel("Nome do evento").fill(name);
  await page.getByLabel("Local").fill("Parque E2E");
  await page.getByLabel("Início").fill("2026-12-01T18:00");
  await page.getByLabel("Término").fill("2026-12-01T23:00");
}

async function createEventViaUi(page: Page, name: string) {
  await page.goto("/eventos");
  await page.getByRole("main").getByRole("link", { name: "Novo evento" }).click();
  await page.waitForURL(/\/eventos\/novo$/);
  await fillNewEvent(page, name);
  await page.getByRole("button", { name: "Criar evento" }).click();
  await page.waitForURL(/\/eventos\/(?!novo)[^/]+$/);
}

function cardOf(page: Page, name: string) {
  return page.getByRole("main").locator("li").filter({ hasText: name });
}

test.describe("Criar e editar evento", () => {
  test("cria pela tela, edita, e a lista mostra o que mudou", async ({ page }) => {
    await login(page);
    const name = uniqueName("Show E2E");

    await createEventViaUi(page, name);

    await page.goto("/eventos");
    await expect(cardOf(page, name)).toContainText("Gestor");
    await expect(cardOf(page, name)).toContainText("Parque E2E");

    await cardOf(page, name).getByRole("link", { name: `Editar ${name}` }).click();
    await page.waitForURL(/\/editar$/);
    await expect(page.getByLabel("Nome do evento")).toHaveValue(name);
    await expect(page.getByLabel("Local")).toHaveValue("Parque E2E");

    const renamed = `${name} (renomeado)`;
    await page.getByLabel("Nome do evento").fill(renamed);
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await page.waitForURL(/\/eventos\/(?!novo)[^/]+$/);

    await page.goto("/eventos");
    await expect(cardOf(page, renamed)).toBeVisible();
    await expect(page.getByRole("main").getByText(name, { exact: true })).toHaveCount(0);
  });

  test("a edição chega ao aparelho que já preparou o evento — e continua lá sem rede", async ({ browser }) => {
    // Aparelho A: cria o evento e o prepara para uso offline.
    const deviceA = await browser.newContext();
    const pageA = await deviceA.newPage();
    await login(pageA);
    const name = uniqueName("Evento propagado");
    await createEventViaUi(pageA, name);
    await pageA.getByRole("button", { name: "Preparar evento para uso offline" }).click();
    await expect(pageA.getByText("Disponível offline", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(pageA.getByRole("heading", { name })).toBeVisible();

    // Aparelho B (outra sessão, mesma conta): o gestor renomeia e cancela o evento.
    const deviceB = await browser.newContext();
    const pageB = await deviceB.newPage();
    await login(pageB);
    await pageB.goto("/eventos");
    await cardOf(pageB, name).getByRole("link", { name: `Editar ${name}` }).click();
    const renamed = `${name} — cancelado`;
    await pageB.getByLabel("Nome do evento").fill(renamed);
    await pageB.getByLabel("Situação").selectOption("CANCELLED");
    await pageB.getByRole("button", { name: "Salvar alterações" }).click();
    await pageB.waitForURL(/\/eventos\/(?!novo)[^/]+$/);

    // Aparelho A: ao sincronizar, o nome novo chega SEM precisar preparar o evento de novo.
    await pageA.getByRole("button", { name: "Sincronizar agora" }).first().click();
    await expect(pageA.getByRole("heading", { name: renamed })).toBeVisible({ timeout: 20_000 });

    // E fica guardado no aparelho: recarregar sem rede mostra o nome novo (vem do IndexedDB).
    await deviceA.setOffline(true);
    await pageA.reload();
    await expect(pageA.getByRole("heading", { name: renamed })).toBeVisible({ timeout: 15_000 });

    await deviceA.close();
    await deviceB.close();
  });

  test("sem conexão, o formulário explica que exige internet e mantém o que foi digitado", async ({
    page,
    context,
  }) => {
    await login(page);
    await page.goto("/eventos/novo");
    const name = uniqueName("Criado depois de reconectar");
    await fillNewEvent(page, name);

    await context.setOffline(true);
    await page.getByRole("button", { name: "Criar evento" }).click();

    // Restrito ao formulário: o Next também tem um `role="alert"` próprio (anúncio de rota).
    await expect(page.getByRole("form", { name: "Dados do evento" }).getByRole("alert")).toContainText(
      "exige internet"
    );
    await expect(page.getByLabel("Nome do evento")).toHaveValue(name);
    await expect(page).toHaveURL(/\/eventos\/novo$/);

    // Voltou a conexão: o mesmo formulário, sem redigitar nada, agora cria.
    await context.setOffline(false);
    await page.getByRole("button", { name: "Criar evento" }).click();
    await page.waitForURL(/\/eventos\/(?!novo)[^/]+$/);
    await page.goto("/eventos");
    await expect(cardOf(page, name)).toBeVisible();
  });
});

test.describe("Permissões de criar e editar evento", () => {
  test("quem é da equipe de campo não vê 'Novo evento' nem 'Editar', e a URL direta e a API recusam", async ({
    page,
  }) => {
    await login(page, FIELD_STAFF_EMAIL);
    await page.goto("/eventos");
    const main = page.getByRole("main");
    await expect(main.getByText("Festival Na Escuta 2026")).toBeVisible();
    await expect(main.getByRole("link", { name: "Novo evento" })).toHaveCount(0);
    await expect(main.getByRole("link", { name: /^Editar/ })).toHaveCount(0);

    await page.goto("/eventos/novo");
    await expect(page.getByText("Você não tem permissão para criar eventos nesta empresa.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar evento" })).toHaveCount(0);

    await page.goto("/eventos");
    const href = await main
      .locator('a[href^="/eventos/"]')
      .filter({ hasText: "Festival Na Escuta 2026" })
      .first()
      .getAttribute("href");
    expect(href).toMatch(/^\/eventos\/[^/]+$/);
    await page.goto(`${href}/editar`);
    await expect(page.getByText("Só o gestor do evento pode editá-lo.")).toBeVisible();

    // Direto na API, sem passar pela tela: o servidor recusa por conta própria.
    const payload = { name: "Invasão", startDate: "2026-12-01T12:00:00.000Z", endDate: "2026-12-02T12:00:00.000Z" };
    const created = await page.request.post("/api/eventos", { data: payload });
    expect(created.status()).toBe(403);
    const edited = await page.request.patch(`/api${href}`, { data: { ...payload, baseVersion: 1 } });
    expect(edited.status()).toBe(403);
  });

  test("sem sessão, a API recusa com 401", async ({ request }) => {
    const created = await request.post("/api/eventos", { data: {} });
    expect(created.status()).toBe(401);
    const edited = await request.patch("/api/eventos/qualquer", { data: {} });
    expect(edited.status()).toBe(401);
  });

  test("o gestor do evento do seed abre a edição normalmente", async ({ page }) => {
    await login(page);
    await openFirstEvent(page);
    const eventUrl = page.url();

    await page.goto(`${eventUrl}/editar`);

    await expect(page.getByRole("heading", { name: "Editar evento" })).toBeVisible();
    await expect(page.getByLabel("Nome do evento")).toHaveValue(/Festival Na Escuta 2026/);
  });
});
