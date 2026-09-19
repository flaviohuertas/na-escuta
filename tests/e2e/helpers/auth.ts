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

/** Abre o primeiro evento listado (o seed cria exatamente um). */
export async function openFirstEvent(page: Page) {
  await page.goto("/eventos");
  // Restrito ao <main>: o primeiro link da página é o logo do menu lateral (→ /eventos).
  await page.getByRole("main").getByRole("link").first().click();
  await page.waitForURL(/\/eventos\/[^/]+$/);
  // A tela do evento renderiza "Carregando…" no servidor e só resolve depois da
  // hidratação + consulta ao Dexie. Sem esperar isso, checagens imediatas como
  // `prepareButton.isVisible()` dão falso negativo e o teste desliga a rede antes
  // de o JS da página terminar de carregar.
  await expect(page.getByRole("main").getByText("Carregando…")).toBeHidden({ timeout: 15_000 });
}
