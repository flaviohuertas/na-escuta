import { expect, test } from "@playwright/test";
import { login, openFirstEvent } from "./helpers/auth";

test.describe("Telas que exigem conexão, sem conexão", () => {
  test("mostra o fallback com os eventos preparados em vez da página de erro do navegador", async ({
    page,
    context,
  }) => {
    await login(page);
    await openFirstEvent(page);

    const prepareButton = page.getByRole("button", { name: "Preparar evento para uso offline" });
    if (await prepareButton.isVisible()) {
      await prepareButton.click();
    }
    await expect(page.getByText("Disponível offline", { exact: true })).toBeVisible({ timeout: 30_000 });
    const eventUrl = page.url();

    // `/painel` lê o Postgres ao vivo: não é guardado, então sem rede o Service Worker responde
    // com a tela de fallback (pré-carregada na instalação) e não com o erro do navegador.
    await context.setOffline(true);
    await page.goto("/painel");
    await expect(page.getByRole("heading", { name: "Esta tela precisa de internet" })).toBeVisible();

    // O evento preparado aparece na lista e abre normalmente, ainda sem rede.
    await page.getByRole("link", { name: /Festival Na Escuta/ }).click();
    await page.waitForURL(eventUrl);
    await expect(page.getByRole("link", { name: "Tarefas" })).toBeVisible();

    await context.setOffline(false);
  });
});
