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

/** Uma validade que nunca vence nos testes. */
export const FUTURE = "2099-12-31";

/**
 * Cria o rascunho v1 de uma proposta pela tela (2 × R$ 5.000,00 + 1 × R$ 1.500,00 − R$ 500,00 =
 * R$ 11.000,00, com validade) e devolve a URL da proposta.
 */
export async function createDraftViaUi(page: Page, oppUrl: string, validUntil = FUTURE) {
  const fillItem = async (n: number, description: string, quantity: string, price: string) => {
    await page.getByLabel(`Descrição do item ${n}`).fill(description);
    await page.getByLabel(`Quantidade do item ${n}`).fill(quantity);
    await page.getByLabel(`Preço unitário do item ${n}`).fill(price);
  };
  await page.goto(oppUrl);
  await page.getByRole("link", { name: "Nova proposta" }).click();
  await page.waitForURL(/\/propostas\/nova$/);
  await fillItem(1, "Som e iluminação", "2", "5.000,00");
  await page.getByRole("button", { name: "Adicionar item" }).click();
  await fillItem(2, "Equipe de palco", "1", "1.500,00");
  await page.getByLabel(/Desconto/).fill("500,00");
  await page.getByLabel("Válida até").fill(validUntil);
  await page.getByLabel(/Condições e observações/).fill("Pagamento em 3x");
  await page.getByRole("button", { name: "Criar rascunho" }).click();
  await page.waitForURL(/\/comercial\/propostas\/(?!nova)[^/]+$/);
  return page.url();
}

/** Abre um painel de confirmação e confirma (enviar, aceitar, recusar…). */
export async function confirmAction(page: Page, open: string, confirm: string) {
  await page.getByRole("button", { name: open }).click();
  await page.getByRole("button", { name: confirm }).click();
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
