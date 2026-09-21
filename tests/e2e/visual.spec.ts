import { expect, test } from "@playwright/test";
import { login } from "./helpers/auth";

/**
 * Aparência: capturas de referência dos estados que NÃO dependem de dados (login, formulário vazio,
 * menu, painel "Mais"). Se um espaçamento, uma cor, uma fonte ou o desenho do menu mudar sem querer,
 * o teste mostra a diferença.
 *
 * As imagens de referência ficam em `visual.spec.ts-snapshots/` e levam o sistema no nome
 * (`-chromium-win32.png`): fonte e suavização mudam de um sistema para outro. Em outro sistema, gere as
 * suas com `npx playwright test visual --update-snapshots` — não copie as de um para o outro.
 * Mudança de propósito na aparência: rode com `--update-snapshots`, olhe as imagens e faça commit.
 */

const FIELD_STAFF_EMAIL = "equipe@naescuta.com.br"; // criado pelo seed; nunca é revisor de propostas, então não há contagem no menu

// Tolerância curta de propósito: com 0,5% de uma tela cheia (5 mil pixels), a troca de cantos
// arredondados de um botão passava despercebida. A renderização se repete pixel a pixel no mesmo sistema.
const options = { animations: "disabled", caret: "hide", scale: "css", maxDiffPixels: 20 } as const;

async function settled(page: import("@playwright/test").Page) {
  // Sem "networkidle": o app faz ping de conectividade de tempos em tempos e a rede nunca fica ociosa.
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);
}

test.describe("aparência — desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("login", async ({ page }) => {
    await page.goto("/login");
    await settled(page);
    await expect(page).toHaveScreenshot("login-desktop.png", options);
  });

  test("formulário de novo evento (titular)", async ({ page }) => {
    await login(page);
    await page.goto("/eventos/novo");
    await settled(page);
    await expect(page.getByRole("main")).toHaveScreenshot("novo-evento-desktop.png", options);
  });

  test("barra lateral do titular (a contagem de aprovações depende dos dados e fica invisível)", async ({ page }) => {
    await login(page);
    // `visibility: hidden` (e não `mask`): a caixa da máscara só apareceria quando há pendências e a
    // referência, gerada sem nenhuma, não a tem. Escondido, o espaço é o mesmo com ou sem número.
    await page.addStyleTag({ content: '[aria-label$="aguardando sua decisão"] { visibility: hidden; }' });
    await settled(page);
    await expect(page.getByRole("navigation", { name: "Menu principal", exact: true })).toHaveScreenshot("barra-lateral-titular.png", options);
  });

  test("barra lateral da equipe de campo", async ({ page }) => {
    await login(page, FIELD_STAFF_EMAIL);
    await settled(page);
    await expect(page.getByRole("navigation", { name: "Menu principal", exact: true })).toHaveScreenshot("barra-lateral-campo.png", options);
  });
});

test.describe("aparência — celular", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("login", async ({ page }) => {
    await page.goto("/login");
    await settled(page);
    await expect(page).toHaveScreenshot("login-celular.png", options);
  });

  test("barra de abas da equipe de campo", async ({ page }) => {
    await login(page, FIELD_STAFF_EMAIL);
    await settled(page);
    await expect(page.getByRole("navigation", { name: "Menu principal (barra inferior)" })).toHaveScreenshot("barra-abas-campo.png", options);
  });

  test("painel 'Mais' da equipe de campo", async ({ page }) => {
    await login(page, FIELD_STAFF_EMAIL);
    await page.getByRole("button", { name: "Mais" }).click();
    const sheet = page.getByRole("dialog", { name: "Menu", exact: true });
    await expect(sheet).toBeVisible();
    await page.mouse.move(0, 0); // o ponteiro ficou onde se tocou em "Mais", agora em cima do "Sair": sem hover na imagem
    await settled(page);
    await expect(sheet).toHaveScreenshot("painel-mais-campo.png", options);
  });

  test("formulário de novo evento (titular)", async ({ page }) => {
    await login(page);
    await page.goto("/eventos/novo");
    await settled(page);
    // A barra de abas é fixa e cobre o pé da tela; o pontinho de pendência dela depende dos dados. Fica coberta.
    await expect(page.getByRole("main")).toHaveScreenshot("novo-evento-celular.png", {
      ...options,
      mask: [page.getByRole("navigation", { name: "Menu principal (barra inferior)" })],
    });
  });
});
