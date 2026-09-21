import { expect, test, type Locator, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

const FIELD_STAFF_EMAIL = "equipe@naescuta.com.br"; // criado pelo seed: equipe de campo, sem escritório

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Menu principal", exact: true });
const bottomBar = (page: Page) => page.getByRole("navigation", { name: "Menu principal (barra inferior)" });
const moreSheet = (page: Page) => page.getByRole("dialog", { name: "Menu", exact: true });

// "Aprovações" leva, dentro do nome acessível, o aviso de quantas propostas esperam a decisão
// ("Aprovações 2 aguardando sua decisão"): o nome exato só vale quando não há nenhuma.
const linkName = (item: string) => (item === "Aprovações" ? /^Aprovações/ : item);
const linkOf = (scope: Locator, item: string) => scope.getByRole("link", { name: linkName(item), exact: item !== "Aprovações" });

test.describe("Menu: barra lateral no desktop, barra de abas no celular", () => {
  test("desktop: itens agrupados, a página aberta marcada e só um menu visível", async ({ page }) => {
    await login(page);

    // Um único <nav> visível: a barra de baixo do celular não aparece aqui.
    await expect(page.getByRole("navigation")).toHaveCount(1);
    await expect(bottomBar(page)).toHaveCount(0);

    const menu = sidebar(page);
    for (const group of ["Operação", "Negócios", "Gestão", "Sistema"]) {
      await expect(menu.getByText(group, { exact: true })).toBeVisible();
    }
    for (const item of ["Painel", "Eventos", "Comercial", "Fornecedores", "Financeiro", "Aprovações", "Conflitos", "Sincronização", "Equipe"]) {
      await expect(linkOf(menu, item)).toBeVisible();
    }
    await expect(menu.getByRole("link", { name: "Trocar senha" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Sair" })).toBeVisible();

    // Está em /eventos: só "Eventos" fica marcado — e continua marcado numa tela de dentro dele.
    await expect(menu.getByRole("link", { name: "Eventos", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(menu.getByRole("link", { name: "Painel", exact: true })).not.toHaveAttribute("aria-current", "page");
    await page.goto("/eventos/novo");
    await expect(menu.getByRole("link", { name: "Eventos", exact: true })).toHaveAttribute("aria-current", "page");

    // Navegar pelo menu leva à tela e passa a marcá-la.
    await menu.getByRole("link", { name: "Comercial", exact: true }).click();
    await expect(page).toHaveURL(/\/comercial$/);
    await expect(menu.getByRole("link", { name: "Comercial", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test.describe("celular", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("titular: quatro abas e 'Mais'; o painel abre, leva às telas e fecha ao navegar", async ({ page }) => {
      await login(page);

      // Só a barra de baixo está visível; a lateral some.
      await expect(page.getByRole("navigation")).toHaveCount(1);
      await expect(sidebar(page)).toHaveCount(0);

      const bar = bottomBar(page);
      await expect(bar.getByRole("link")).toHaveText(["Painel", "Eventos", "Comercial", "Financeiro"]);
      await expect(bar.getByRole("link", { name: "Eventos", exact: true })).toHaveAttribute("aria-current", "page");
      await expect(bar.getByRole("button", { name: "Mais" })).toBeVisible();

      // O que não coube na barra está em "Mais", com a conta.
      await expect(moreSheet(page)).toBeHidden();
      await bar.getByRole("button", { name: "Mais" }).click();
      const sheet = moreSheet(page);
      await expect(sheet).toBeVisible();
      for (const item of ["Fornecedores", "Aprovações", "Conflitos", "Sincronização", "Equipe"]) {
        await expect(linkOf(sheet, item)).toBeVisible();
      }
      await expect(sheet.getByRole("link", { name: "Painel" })).toHaveCount(0); // já está na barra
      await expect(sheet.getByRole("link", { name: "Trocar senha" })).toBeVisible();

      // Escape fecha.
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();

      // Clicar num item leva à tela e fecha o painel (o menu não é recriado ao navegar).
      await bar.getByRole("button", { name: "Mais" }).click();
      await sheet.getByRole("link", { name: "Fornecedores", exact: true }).click();
      await expect(page).toHaveURL(/\/fornecedores$/);
      await expect(sheet).toBeHidden();

      // Sair pede confirmação, dentro do painel (diálogo dentro de diálogo).
      await bar.getByRole("button", { name: "Mais" }).click();
      await sheet.getByRole("button", { name: "Sair" }).click();
      await expect(page.getByRole("heading", { name: "Sair da conta" })).toBeVisible();
      await page.getByRole("button", { name: "Cancelar" }).click();
      await expect(page.getByRole("heading", { name: "Sair da conta" })).toBeHidden();
    });

    test("equipe de campo: sem Comercial nem Financeiro; a barra fica com o que o campo consulta", async ({ page }) => {
      await login(page, FIELD_STAFF_EMAIL);

      const bar = bottomBar(page);
      await expect(bar.getByRole("link")).toHaveText(["Painel", "Eventos", "Conflitos", "Sincronização"]);
      await bar.getByRole("button", { name: "Mais" }).click();
      const sheet = moreSheet(page);
      await expect(linkOf(sheet, "Aprovações")).toBeVisible();
      for (const forbidden of ["Comercial", "Fornecedores", "Financeiro", "Equipe"]) {
        await expect(page.getByRole("link", { name: forbidden, exact: true })).toHaveCount(0);
      }
    });

    test("o zoom está liberado: quem enxerga pouco precisa poder ampliar", async ({ page }) => {
      await login(page);
      const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
      expect(viewport).not.toMatch(/maximum-scale|user-scalable\s*=\s*(no|0)/);
    });

    test("não há rolagem lateral", async ({ page }) => {
      await login(page);
      for (const path of ["/comercial", "/fornecedores", "/financeiro"]) {
        await page.goto(path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${path} vaza da tela`).toBeLessThanOrEqual(0);
      }
    });

    test("a barra fixa não cobre o fim da página: o conteúdo reserva o espaço dela", async ({ page }) => {
      await login(page);
      await page.goto("/comercial");
      const barHeight = (await bottomBar(page).boundingBox())!.height;
      const mainPadding = await page.getByRole("main").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
      expect(mainPadding).toBeGreaterThanOrEqual(barHeight);
    });

    test("cada aba (e o 'Mais') tem pelo menos 44 px de altura", async ({ page }) => {
      await login(page);
      const targets = [...(await bottomBar(page).getByRole("link").all()), bottomBar(page).getByRole("button", { name: "Mais" })];
      expect(targets).toHaveLength(5);
      for (const target of targets) {
        expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    });
  });
});
