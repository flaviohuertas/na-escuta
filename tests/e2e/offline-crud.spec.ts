import { expect, test } from "@playwright/test";
import { login, openFirstEvent } from "./helpers/auth";

test.describe("Criar e editar registros offline", () => {
  test("cria tarefa, item de checklist e ocorrência sem conexão", async ({ page, context }) => {
    await login(page);
    await openFirstEvent(page);

    const prepareButton = page.getByRole("button", { name: "Preparar evento para uso offline" });
    if (await prepareButton.isVisible()) {
      await prepareButton.click();
      await expect(page.getByText("Disponível offline", { exact: true })).toBeVisible({ timeout: 30_000 });
    }

    await context.setOffline(true);

    // Tarefa
    await page.getByRole("link", { name: "Tarefas" }).click();
    await page.getByLabel("Nova tarefa").fill("Testar geradores (offline)");
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByText("Testar geradores (offline)")).toBeVisible();
    await expect(page.getByText("Pendente").first()).toBeVisible();

    // Checklist
    await page.goBack();
    await page.getByRole("link", { name: "Checklists" }).click();
    await page.getByLabel("Novo checklist").fill("Checklist criado offline");
    await page.getByRole("button", { name: "Criar" }).click();
    await expect(page.getByText("Checklist criado offline")).toBeVisible();

    // O checklist acabou de nascer neste aparelho: o id é novo e NENHUM cache jamais viu a URL
    // dele. Antes, abrir o detalhe offline dava a página de erro do navegador.
    await page.getByRole("link", { name: /Checklist criado offline/ }).click();
    await expect(page.getByRole("heading", { name: "Checklist criado offline" })).toBeVisible();
    await page.getByLabel("Novo item").fill("Item criado offline");
    await page.getByRole("button", { name: "Adicionar" }).click();
    await expect(page.getByText("Item criado offline")).toBeVisible();
    // Recarregar o detalhe (id novo) também precisa funcionar sem rede.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Checklist criado offline" })).toBeVisible();
    await expect(page.getByText("Item criado offline")).toBeVisible();

    // Ocorrência
    await page.getByRole("link", { name: /Voltar aos checklists/ }).click();
    await page.getByRole("link", { name: /Voltar ao evento/ }).click();
    await page.getByRole("link", { name: "Ocorrências" }).click();
    await page.getByLabel("Título").fill("Ocorrência registrada offline");
    await page.getByRole("button", { name: "Registrar ocorrência" }).click();
    await expect(page.getByText("Ocorrência registrada offline")).toBeVisible();
    await page.getByRole("link", { name: /Ocorrência registrada offline/ }).click();
    await expect(page.getByRole("heading", { name: "Ocorrência registrada offline" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ocorrência registrada offline" })).toBeVisible();

    await context.setOffline(false);
  });
});
