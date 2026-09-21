/**
 * Regras PURAS do cadastro de fornecedores: rótulos, o que o histórico diz e o resumo do que se
 * gastou/orçou com cada um. Sem banco e sem rede — servem ao servidor (que decide) e às telas
 * (que mostram). CPF/CNPJ, dinheiro e categorias são os do comercial e do orçamento.
 */
import { categoryLabel } from "./budget";
import { formatDocument } from "./crm";

export const SUPPLIER_KINDS = ["COMPANY", "PERSON"] as const;
export type SupplierKindName = (typeof SUPPLIER_KINDS)[number];

export const SUPPLIER_KIND_LABEL: Record<SupplierKindName, string> = {
  COMPANY: "Empresa",
  PERSON: "Pessoa",
};

export const MAX_SUPPLIER_NAME = 200;
export const MAX_CONTACT_NAME = 120;
export const MAX_SUPPLIER_NOTES = 2000;

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

const SUPPLIER_FIELD_LABEL: Array<[string, string]> = [
  ["kind", "tipo"],
  ["document", "documento"],
  ["contactName", "contato"],
  ["email", "e-mail"],
  ["phone", "telefone"],
  ["category", "categoria"],
  ["notes", "observações"],
];

/** Um valor de campo como a pessoa lê no histórico (documento com máscara, categoria em português). */
function readable(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (key === "document" && typeof value === "string") return formatDocument(value);
  if (key === "category" && typeof value === "string") return categoryLabel(value);
  if (key === "kind" && typeof value === "string") return SUPPLIER_KIND_LABEL[value as SupplierKindName] ?? value;
  return String(value);
}

/**
 * Uma linha do histórico do fornecedor, em palavras, a partir do que o servidor gravou na auditoria
 * (o estado antes e depois). Quando o nome mudou, a auditoria diz em quantos itens de orçamento e
 * lançamentos o nome foi atualizado (`metadata`). Ação desconhecida sai como veio — nunca some.
 */
export function describeSupplierHistory(action: string, before: unknown, after: unknown, metadata?: unknown): string {
  const b = asRecord(before);
  const a = asRecord(after);
  const m = asRecord(metadata);

  switch (action) {
    case "SUPPLIER_CREATED":
      return "Fornecedor cadastrado.";
    case "SUPPLIER_UPDATED": {
      const changed: string[] = [];
      if (b.name !== a.name) {
        const items = typeof m.renamedBudgetItems === "number" ? m.renamedBudgetItems : 0;
        const expenses = typeof m.renamedExpenses === "number" ? m.renamedExpenses : 0;
        const spread =
          items + expenses > 0
            ? `; atualizado em ${items} ${items === 1 ? "item de orçamento" : "itens de orçamento"} e ${expenses} ${expenses === 1 ? "lançamento" : "lançamentos"}`
            : "";
        changed.push(`nome (de ${readable("name", b.name)} para ${readable("name", a.name)}${spread})`);
      }
      for (const [key, label] of SUPPLIER_FIELD_LABEL) {
        if (JSON.stringify(b[key] ?? null) !== JSON.stringify(a[key] ?? null)) {
          changed.push(key === "category" ? `${label} (${readable(key, b[key])} → ${readable(key, a[key])})` : label);
        }
      }
      return changed.length > 0 ? `Editado: ${changed.join(", ")}.` : "Cadastro editado.";
    }
    case "SUPPLIER_ARCHIVED":
      return "Fornecedor arquivado.";
    case "SUPPLIER_RESTORED":
      return "Fornecedor reativado.";
    default:
      return action;
  }
}

export interface SpendGroup {
  /** Um evento (gasto) ou uma oportunidade (previsto). */
  id: string;
  name: string;
  totalCents: number;
  count: number;
}

/**
 * O resumo do que se gastou (lançamentos ATIVOS) e do que se orçou com um fornecedor: os totais
 * saem da soma dos grupos — nunca de um número solto —, para o total e a lista não discordarem.
 */
export function summarizeSpend(realized: readonly SpendGroup[], planned: readonly SpendGroup[]) {
  const sum = (groups: readonly SpendGroup[]) => groups.reduce((total, group) => total + group.totalCents, 0);
  const count = (groups: readonly SpendGroup[]) => groups.reduce((total, group) => total + group.count, 0);
  return {
    realizedTotalCents: sum(realized),
    realizedCount: count(realized),
    plannedTotalCents: sum(planned),
    plannedCount: count(planned),
    /** Gastou-se mais do que se orçou COM este fornecedor (só se há orçamento com ele). */
    overPlanned: planned.length > 0 && sum(realized) > sum(planned),
  };
}

/** Uma linha curta para listas: "Empresa · 11.222.333/0001-81 · Som, luz e imagem". */
export function supplierSummaryLine(supplier: { kind: string; document: string | null; category: string | null }): string {
  return [
    SUPPLIER_KIND_LABEL[supplier.kind as SupplierKindName] ?? supplier.kind,
    supplier.document ? formatDocument(supplier.document) : null,
    supplier.category ? categoryLabel(supplier.category) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
