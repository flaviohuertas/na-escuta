import { expect, test } from "@playwright/test";
import { login, openFirstEvent } from "./helpers/auth";

test.describe("Fechar/reabrir e reconectar sem duplicar", () => {
  test("dados sobrevivem a fechar e reabrir, e reconectar sincroniza sem duplicar", async ({
    page,
    context,
  }) => {
    await login(page);
    await openFirstEvent(page);

    const prepareButton = page.getByRole("button", { name: "Preparar evento para uso offline" });
    if (await prepareButton.isVisible()) {
      await prepareButton.click();
      await expect(page.getByText("Evento preparado com sucesso")).toBeVisible({ timeout: 30_000 });
    }
    const eventUrl = page.url();

    await context.setOffline(true);
    await page.getByRole("link", { name: "Tarefas" }).click();

    const uniqueTitle = `Tarefa persistente ${Date.now()}`;
    await page.getByLabel("Nova tarefa").fill(uniqueTitle);
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByText(uniqueTitle)).toBeVisible();

    // "Fecha e reabre": nova página no mesmo contexto (mesmo IndexedDB de origem).
    const page2 = await context.newPage();
    await page2.goto(eventUrl + "/tarefas");
    await expect(page2.getByText(uniqueTitle)).toBeVisible();
    await page.close();

    // Reconecta: sincroniza e não deve duplicar a tarefa localmente nem no servidor.
    await context.setOffline(false);
    await page2.getByRole("button", { name: "Sincronizar agora" }).click();
    await expect(page2.getByText("Sincronizado").first()).toBeVisible({ timeout: 15_000 });

    await page2.reload();
    const matches = page2.getByText(uniqueTitle);
    await expect(matches).toHaveCount(1);

    await page2.close();
  });
});
