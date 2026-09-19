import { expect, type Page } from "@playwright/test";

export const DEMO_EMAIL = "demo@naescuta.com.br";
export const DEMO_PASSWORD = "NaEscuta#2026";

/** Login via credenciais de demo criadas pelo `npm run db:seed`. */
export async function login(page: Page, email = DEMO_EMAIL, password = DEMO_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("/eventos");
}

/** Nome (parte) do evento que o seed cria. Outros specs criam eventos próprios, então "o primeiro da lista" não é mais o do seed. */
export const SEED_EVENT_NAME = "Festival Na Escuta 2026";

/** Abre o evento do seed pelo nome. */
export async function openFirstEvent(page: Page, eventName = SEED_EVENT_NAME) {
  await page.goto("/eventos");
  // Restrito ao <main> (o primeiro link da página é o logo do menu) e ao link do CARTÃO do evento:
  // "Novo evento" e "Editar" também são links ali, mas não trazem o nome do evento no texto.
  await page
    .getByRole("main")
    .locator('a[href^="/eventos/"]')
    .filter({ hasText: eventName })
    .first()
    .click();
  await page.waitForURL(/\/eventos\/[^/]+$/);
  // A tela do evento renderiza "Carregando…" no servidor e só resolve depois da
  // hidratação + consulta ao Dexie. Sem esperar isso, checagens imediatas como
  // `prepareButton.isVisible()` dão falso negativo e o teste desliga a rede antes
  // de o JS da página terminar de carregar.
  await expect(page.getByRole("main").getByText("Carregando…")).toBeHidden({ timeout: 15_000 });
}
