import { expect, test } from "@playwright/test";
import { login, openFirstEvent } from "./helpers/auth";

/**
 * "Falha parcial", sessão expirada e quota insuficiente já têm cobertura
 * unitária determinística (tests/unit/sync/engine.test.ts,
 * tests/unit/auth/offline-session.test.ts, tests/unit/storage/
 * persistence.test.ts) — mais confiável do que tentar forçar essas
 * condições de fora em um browser real. Este E2E cobre especificamente o
 * caminho de sessão expirada: a edição feita antes de expirar não pode se
 * perder, e o erro deve ficar visível (não falhar silenciosamente).
 */
test.describe("Sessão expirada durante sincronização", () => {
  test("outbox permanece intacta e o erro fica visível quando a sessão web expira", async ({
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

    await page.getByRole("link", { name: "Tarefas" }).click();
    const title = `Tarefa antes da sessão expirar ${Date.now()}`;
    await page.getByLabel("Nova tarefa").fill(title);
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByText(title)).toBeVisible();

    // Simula sessão web expirada: remove os cookies de autenticação sem
    // tocar no IndexedDB (a outbox local deve continuar intacta).
    await context.clearCookies();

    await page.getByRole("button", { name: "Sincronizar agora" }).click();
    await expect(page.getByText(/Erro ao sincronizar/)).toBeVisible({ timeout: 15_000 });

    // A tarefa continua lá — nada foi perdido por causa da falha de sync.
    await expect(page.getByText(title)).toBeVisible();
  });
});
