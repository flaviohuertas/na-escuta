import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers/auth";
import { convertToEventViaUi, createBudgetViaUi, createClientViaUi, createDraftViaUi, createOpportunityViaUi } from "./helpers/crm";

/**
 * Acessibilidade das telas (axe-core, WCAG 2.0/2.1 A e AA): contraste medido NO NAVEGADOR sobre o que
 * de fato foi desenhado, estrutura (listas, regiões rolantes, links) e nomes. Zero violações.
 *
 * O que o axe NÃO faz: julgar se um texto faz sentido, ler com leitor de tela de verdade, nem testar
 * em aparelho. Os "incompletos" (contraste sobre imagem, por exemplo) ficam fora — aqui não há imagem
 * de fundo com texto.
 */

const FIELD_STAFF_EMAIL = "equipe@naescuta.com.br"; // criado pelo seed: equipe de campo, sem escritório
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectAccessible(page: Page, label: string) {
  // Sem "networkidle": o app faz ping de conectividade de tempos em tempos e a rede nunca fica ociosa.
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready);
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const report = violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes
          .slice(0, 4)
          .map((n) => `   ${n.target.join(" ")}\n   ${(n.failureSummary ?? "").split("\n").slice(0, 2).join(" ")}`)
          .join("\n")
    )
    .join("\n");
  expect(violations, `${label}\n${report}`).toEqual([]);
}

interface DetailUrls {
  opportunity: string;
  proposal: string;
  budget: string;
  supplier: string;
  finance: string;
}

/**
 * Cria, pela tela, os dados das telas de detalhe — uma vez por processo, pelo primeiro teste que
 * precisar (a página já deve estar logada como titular). Não depende da ordem dos testes.
 */
let prepared: Promise<DetailUrls> | null = null;
function prepareDetailData(page: Page): Promise<DetailUrls> {
  prepared ??= (async () => {
    const stamp = Date.now();
    // Nome CURTO de propósito: o axe só trata o link como "dentro de um bloco de texto" (regra
    // link-in-text-block) quando o texto ao redor é maior que o do próprio link.
    const supplierName = `Som ${String(stamp).slice(-5)}`;
    await page.goto("/fornecedores/novo");
    await page.getByLabel("Nome", { exact: true }).fill(supplierName);
    await page.getByRole("button", { name: "Cadastrar fornecedor" }).click();
    await page.waitForURL(/\/fornecedores\/(?!novo)[^/]+$/);
    const supplier = page.url();

    const clientUrl = await createClientViaUi(page, `Cliente Acessível ${stamp}`);
    const opportunity = await createOpportunityViaUi(page, clientUrl, `Evento Acessível ${stamp}`, { value: "15.000,00", start: "2027-03-01", end: "2027-03-03" });
    await createBudgetViaUi(page, opportunity);
    const proposal = await createDraftViaUi(page, opportunity);

    // Um lançamento ligado ao fornecedor cadastrado: é onde aparece o link dentro de uma linha de texto.
    const eventId = await convertToEventViaUi(page, opportunity);
    const finance = `/financeiro/eventos/${eventId}`;
    await page.goto(finance);
    await page.getByLabel("Categoria").selectOption("AV");
    await page.getByLabel("Descrição").fill("Som e luz");
    await page.getByLabel("Valor (R$)").fill("1.000,00");
    await page.getByLabel("Fornecedor cadastrado").selectOption({ label: supplierName });
    await page.getByRole("button", { name: "Lançar custo" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Lançamento salvo." })).toBeVisible();

    return { opportunity, proposal, budget: `${opportunity}/orcamento`, supplier, finance };
  })();
  return prepared;
}

const SCREENS: Array<[string, string | ((u: DetailUrls) => string)]> = [
  ["Painel", "/painel"],
  ["Eventos", "/eventos"],
  ["Novo evento", "/eventos/novo"],
  ["Comercial (funil)", "/comercial"],
  ["Clientes", "/comercial/clientes"],
  ["Propostas", "/comercial/propostas"],
  ["Nova oportunidade", "/comercial/oportunidades/nova"],
  ["Oportunidade", (u) => u.opportunity],
  ["Proposta", (u) => u.proposal],
  ["Orçamento", (u) => u.budget],
  ["Fornecedores", "/fornecedores"],
  ["Novo fornecedor", "/fornecedores/novo"],
  ["Ficha do fornecedor", (u) => u.supplier],
  ["Financeiro", "/financeiro"],
  ["Financeiro do evento (com lançamento ligado ao fornecedor)", (u) => u.finance],
  ["Aprovações", "/aprovacoes"],
  ["Conflitos", "/conflitos"],
  ["Sincronização", "/configuracoes/sincronizacao"],
  ["Equipe", "/administracao/equipe"],
  ["Trocar senha", "/trocar-senha"],
];

for (const [device, viewport] of [
  ["desktop", { width: 1280, height: 800 }],
  ["celular", { width: 390, height: 844 }],
] as const) {
  test.describe(`acessibilidade — ${device}`, () => {
    test.use({ viewport });

    test("login (sem sessão)", async ({ page }) => {
      await page.goto("/login");
      await expectAccessible(page, "login");
    });

    for (const [label, target] of SCREENS) {
      test(label, async ({ page }) => {
        test.slow(); // o primeiro a rodar prepara os dados das telas de detalhe
        await login(page);
        if (typeof target === "function") {
          const urls = await prepareDetailData(page);
          await page.goto(target(urls));
        } else {
          await page.goto(target);
        }
        await expectAccessible(page, label);
      });
    }

    test("equipe de campo: Painel, Eventos e Conflitos", async ({ page }) => {
      await login(page, FIELD_STAFF_EMAIL);
      for (const path of ["/painel", "/eventos", "/conflitos"]) {
        await page.goto(path);
        await expectAccessible(page, `${path} (equipe de campo)`);
      }
    });

    test("o painel 'Mais' aberto (celular) e a confirmação de sair", async ({ page }) => {
      test.skip(device === "desktop", "o painel 'Mais' só existe no celular");
      await login(page);
      const sheet = page.getByRole("dialog", { name: "Menu", exact: true });
      await page.getByRole("button", { name: "Mais" }).click();
      await expect(sheet).toBeVisible();
      await expectAccessible(page, "painel Mais aberto");
      await sheet.getByRole("button", { name: "Sair" }).click();
      await expect(page.getByRole("heading", { name: "Sair da conta" })).toBeVisible();
      await expectAccessible(page, "confirmação de sair");
    });
  });
}
