import { expect, test, type Browser } from "@playwright/test";
import { login, openFirstEvent } from "./helpers/auth";

/**
 * Simula dois dispositivos (dois BrowserContext isolados, mesma conta) que
 * preparam o mesmo evento e depois editam a MESMA tarefa preexistente (a
 * primeira da lista, criada pelo seed) — um offline, outro já sincronizado —
 * gerando um conflito real de versão ao reconectar. Resolvido manualmente em
 * /conflitos, nunca por "última gravação vence" automático.
 */
async function prepareDeviceOnEvent(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page);
  await openFirstEvent(page);

  const prepareButton = page.getByRole("button", { name: "Preparar evento para uso offline" });
  if (await prepareButton.isVisible()) {
    await prepareButton.click();
    await expect(page.getByText("Evento preparado com sucesso")).toBeVisible({ timeout: 30_000 });
  }

  await page.getByRole("link", { name: "Tarefas" }).click();
  return { context, page };
}

test.describe("Resolver conflito entre dois dispositivos", () => {
  test("conflito é detectado e resolvido manualmente, nunca sobrescrito silenciosamente", async ({
    browser,
  }) => {
    const deviceA = await prepareDeviceOnEvent(browser);
    const deviceB = await prepareDeviceOnEvent(browser);

    // Dispositivo B avança o status da primeira tarefa ENQUANTO ONLINE —
    // sincroniza de imediato, servidor vai para version 2.
    await deviceB.page.getByRole("button", { name: "Avançar status" }).first().click();
    await deviceB.page.getByRole("button", { name: "Sincronizar agora" }).click();
    await expect(deviceB.page.getByText("Sincronizado").first()).toBeVisible({ timeout: 15_000 });

    // Dispositivo A, sem saber disso, avança a MESMA tarefa OFFLINE — ainda
    // baseado na version 1.
    await deviceA.context.setOffline(true);
    await deviceA.page.getByRole("button", { name: "Avançar status" }).first().click();
    await expect(deviceA.page.getByText("Pendente").first()).toBeVisible();

    // Reconecta e sincroniza — deve gerar conflito, não sobrescrever.
    await deviceA.context.setOffline(false);
    await deviceA.page.getByRole("button", { name: "Sincronizar agora" }).click();
    await expect(deviceA.page.getByText("Conflito").first()).toBeVisible({ timeout: 15_000 });

    await deviceA.page.getByRole("link", { name: /conflito\(s\) para resolver/ }).click();
    await expect(deviceA.page.getByRole("heading", { name: "Conflitos pendentes" })).toBeVisible();

    await deviceA.page.getByRole("button", { name: "Manter minha versão (deste dispositivo)" }).click();
    await expect(deviceA.page.getByText("Nenhum conflito pendente.")).toBeVisible({ timeout: 10_000 });

    await deviceA.context.close();
    await deviceB.context.close();
  });
});
