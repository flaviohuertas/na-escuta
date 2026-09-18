import { expect, test } from "@playwright/test";
import { login, openFirstEvent } from "./helpers/auth";

test.describe("Preparar evento, desconectar e recarregar", () => {
  test("evento preparado abre e recarrega sem conexão", async ({ page, context }) => {
    await login(page);
    await openFirstEvent(page);

    const prepareButton = page.getByRole("button", { name: "Preparar evento para uso offline" });
    if (await prepareButton.isVisible()) {
      await prepareButton.click();
      await expect(page.getByText("Evento preparado com sucesso")).toBeVisible({ timeout: 30_000 });
    }

    const eventUrl = page.url();

    await context.setOffline(true);
    await page.reload();

    // A tela do evento deve renderizar (do IndexedDB via Service Worker/app
    // shell cacheado), não uma página de erro de rede do navegador.
    await expect(page.getByRole("link", { name: "Tarefas" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: "Checklists" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ocorrências" })).toBeVisible();

    await page.getByRole("link", { name: "Tarefas" }).click();
    await page.waitForURL(/\/tarefas$/);
    await expect(page.getByRole("heading", { name: "Tarefas" })).toBeVisible();

    await context.setOffline(false);
    expect(eventUrl).toContain("/eventos/");
  });
});
