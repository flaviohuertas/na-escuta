import type { Page } from "@playwright/test";

/** Um CNPJ VÁLIDO e diferente a cada execução (o banco acumula entre rodadas e o documento é único por empresa). */
export function randomCnpj(): string {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const digit = (digits: number[], weights: number[]) => {
    const rest = digits.reduce((sum, d, i) => sum + d * weights[i]!, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const d1 = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digit([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...base, d1, d2].join("");
}

/** Cadastra um cliente pela tela e devolve a URL dele. */
export async function createClientViaUi(page: Page, name: string, document?: string) {
  await page.goto("/comercial/clientes/novo");
  await page.getByLabel("Nome", { exact: true }).fill(name);
  if (document) await page.getByLabel(/CPF ou CNPJ/).fill(document);
  await page.getByRole("button", { name: "Cadastrar cliente" }).click();
  await page.waitForURL(/\/comercial\/clientes\/(?!novo)[^/]+$/);
  return page.url();
}

/** Abre uma oportunidade para o cliente pela tela e devolve a URL dela. */
export async function createOpportunityViaUi(page: Page, clientUrl: string, title: string, extra: { value?: string; start?: string; end?: string } = {}) {
  await page.goto(clientUrl);
  await page.getByRole("link", { name: "Nova oportunidade" }).click();
  await page.waitForURL(/\/comercial\/oportunidades\/nova\?clienteId=/);
  await page.getByLabel("Título").fill(title);
  if (extra.value) await page.getByLabel(/Valor estimado/).fill(extra.value);
  if (extra.start) await page.getByLabel(/Início previsto/).fill(extra.start);
  if (extra.end) await page.getByLabel(/Término previsto/).fill(extra.end);
  await page.getByRole("button", { name: "Abrir oportunidade" }).click();
  await page.waitForURL(/\/comercial\/oportunidades\/(?!nova)[^/]+$/);
  return page.url();
}
