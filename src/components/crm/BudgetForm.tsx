"use client";

import { useMemo, useState, type FormEvent } from "react";
import { callApi } from "@/components/admin/api";
import { Field, inputClass } from "@/components/crm/Field";
import { buttonClass } from "@/components/ui/Button";
import { AppLink } from "@/components/ui/AppLink";
import { SupplierSelect, type SupplierChoice } from "@/components/suppliers/SupplierSelect";
import {
  BUDGET_CATEGORIES,
  MAX_BUDGET_ITEMS,
  MAX_ITEM_DESCRIPTION,
  MAX_NOTES,
  MAX_QUANTITY,
  MAX_SUPPLIER,
  categoryLabel,
  computeBudgetTotals,
  computeMargin,
  formatBps,
} from "@/lib/domain/budget";
import { BudgetSaveSchema } from "@/lib/domain/budget.schema";
import { centsToInput, formatBRL, parseBRLToCents } from "@/lib/domain/crm";
import { navigateToDocument } from "@/lib/offline/navigate";

export interface BudgetFormInitial {
  items: Array<{ category: string; description: string; quantity: number; unitCostCents: number; supplier: string | null; supplierId?: string | null }>;
  notes: string | null;
}

interface Row {
  key: number;
  category: string;
  description: string;
  supplier: string;
  /** O fornecedor do cadastro escolhido ("" = nenhum). */
  supplierId: string;
  quantity: string;
  cost: string;
}

/** A chave de cada linha do formulário (só para o React separar as linhas; não vai para o servidor). */
let rowKeyCounter = 0;
const newRow = (values: Partial<Omit<Row, "key">> = {}): Row => ({ key: rowKeyCounter++, category: "", description: "", supplier: "", supplierId: "", quantity: "1", cost: "", ...values });

const parseQuantity = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

/**
 * Montar/editar o orçamento interno. Custos digitados em reais ("3.000,00") vão em CENTAVOS
 * inteiros; o custo total e a margem prevista saem da MESMA conta do servidor. `version` é a que a
 * pessoa via (0 = ainda não existia orçamento): se outra pessoa salvou antes, o servidor responde
 * 409 e a tela oferece carregar os dados atuais em vez de sobrescrever.
 */
export function BudgetForm({
  opportunityId,
  version,
  initial,
  revenue,
  cancelHref,
  suppliers = [],
}: {
  opportunityId: string;
  version: number;
  initial?: BudgetFormInitial;
  /** Os fornecedores do cadastro para escolher (vazio: só o texto livre). */
  suppliers?: readonly SupplierChoice[];
  /** A receita de referência (para mostrar a margem enquanto se digita); `null` se não há. */
  revenue: { cents: number; label: string } | null;
  cancelHref: string;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial && initial.items.length > 0
      ? initial.items.map((item) =>
          newRow({
            category: item.category,
            description: item.description,
            supplier: item.supplier ?? "",
            supplierId: item.supplierId ?? "",
            quantity: String(item.quantity),
            cost: centsToInput(item.unitCostCents),
          })
        )
      : [newRow()]
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outdated, setOutdated] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});

  function updateRow(key: number, patch: Partial<Omit<Row, "key">>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  // O que ainda não é um valor válido conta como zero na conta ao vivo (e o envio recusa).
  const live = useMemo(() => {
    const totals = computeBudgetTotals(
      rows.map((row) => ({ category: row.category || "OTHER", quantity: parseQuantity(row.quantity) ?? 0, unitCostCents: parseBRLToCents(row.cost) ?? 0 }))
    );
    return { totals, margin: revenue ? computeMargin(revenue.cents, totals.totalCents) : null };
  }, [rows, revenue]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOutdated(false);
    setFieldErrors({});
    setRowErrors({});

    const problems: Record<number, string> = {};
    const items = rows.map((row, index) => {
      const quantity = parseQuantity(row.quantity);
      const unitCostCents = row.cost.trim() ? parseBRLToCents(row.cost) : null;
      if (quantity === null) problems[index] = "Informe a quantidade como um número inteiro.";
      else if (unitCostCents === null) problems[index] = row.cost.trim() ? "Informe o custo como 3.000,00 (vírgula nos centavos)." : "Informe o custo do item.";
      return {
        category: row.category,
        description: row.description,
        quantity: quantity ?? 0,
        unitCostCents: unitCostCents ?? 0,
        // Com fornecedor do cadastro vale o vínculo (o servidor guarda o nome dele); sem, o texto digitado.
        supplier: row.supplierId ? null : row.supplier.trim() ? row.supplier : null,
        supplierId: row.supplierId || null,
      };
    });
    if (Object.keys(problems).length > 0) {
      setRowErrors(problems);
      return;
    }

    const payload = { items, notes: notes.trim() ? notes : null, baseVersion: version };
    const checked = BudgetSaveSchema.safeParse(payload);
    if (!checked.success) {
      const byRow: Record<number, string> = {};
      const byField: Partial<Record<string, string>> = {};
      for (const issue of checked.error.issues) {
        if (issue.path[0] === "items" && typeof issue.path[1] === "number") byRow[issue.path[1]] ??= issue.message;
        else byField[String(issue.path[0] ?? "")] ??= issue.message;
      }
      setRowErrors(byRow);
      setFieldErrors(byField);
      return;
    }

    setSubmitting(true);
    const result = await callApi("PUT", `/api/comercial/oportunidades/${opportunityId}/orcamento`, payload);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      setOutdated(result.status === 409);
      return;
    }
    navigateToDocument(cancelHref);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-5" aria-label="Dados do orçamento">
      {error && (
        <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error}</p>
          {outdated && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-2" })}
            >
              Carregar os dados atuais
            </button>
          )}
        </div>
      )}

      <fieldset>
        <legend className="text-sm font-semibold text-slate-800">Itens de custo</legend>
        <ul className="mt-2 space-y-3">
          {rows.map((row, index) => {
            const n = index + 1;
            return (
              <li key={row.key} className="rounded-xl border border-line bg-white p-3" data-testid="budget-form-row">
                <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
                  <label className="block">
                    <span aria-hidden="true" className="text-xs text-slate-500">
                      Categoria
                    </span>
                    <select aria-label={`Categoria do item ${n}`} value={row.category} onChange={(e) => updateRow(row.key, { category: e.target.value })} className={inputClass}>
                      <option value="">Escolha…</option>
                      {BUDGET_CATEGORIES.map((category) => (
                        <option key={category.code} value={category.code}>
                          {category.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span aria-hidden="true" className="text-xs text-slate-500">
                      Descrição
                    </span>
                    <input aria-label={`Descrição do item ${n}`} value={row.description} onChange={(e) => updateRow(row.key, { description: e.target.value })} maxLength={MAX_ITEM_DESCRIPTION} className={inputClass} />
                  </label>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_9rem]">
                  <div className="block">
                    <span aria-hidden="true" className="text-xs text-slate-500">
                      Fornecedor (opcional)
                    </span>
                    {/* Um do cadastro (vincula pelo id) ou, sem cadastro, o nome digitado. */}
                    <SupplierSelect label={`Fornecedor cadastrado do item ${n}`} suppliers={suppliers} value={row.supplierId} onChange={(supplierId) => updateRow(row.key, { supplierId })} />
                    {!row.supplierId && (
                      <input aria-label={`Fornecedor do item ${n}`} value={row.supplier} onChange={(e) => updateRow(row.key, { supplier: e.target.value })} maxLength={MAX_SUPPLIER} className={inputClass} />
                    )}
                  </div>
                  <label className="block">
                    <span aria-hidden="true" className="text-xs text-slate-500">
                      Qtd.
                    </span>
                    <input
                      aria-label={`Quantidade do item ${n}`}
                      value={row.quantity}
                      onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                      inputMode="numeric"
                      maxLength={String(MAX_QUANTITY).length}
                      className={inputClass}
                    />
                  </label>
                  <label className="block">
                    <span aria-hidden="true" className="text-xs text-slate-500">
                      Custo unitário (R$)
                    </span>
                    <input aria-label={`Custo unitário do item ${n}`} value={row.cost} onChange={(e) => updateRow(row.key, { cost: e.target.value })} inputMode="decimal" placeholder="3.000,00" className={inputClass} />
                  </label>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <p className="text-slate-600">
                    Total do item:{" "}
                    <span className="font-medium tabular-nums text-slate-900" data-testid={`line-total-${n}`}>
                      {formatBRL(live.totals.lineTotals[index] ?? 0)}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                    disabled={rows.length === 1}
                    aria-label={`Remover item ${n}`}
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    Remover
                  </button>
                </div>
                {rowErrors[index] && (
                  <p role="alert" className="mt-1 text-sm text-red-700">
                    Item {n}: {rowErrors[index]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {fieldErrors.items && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {fieldErrors.items}
          </p>
        )}
        <button
          type="button"
          onClick={() => setRows((current) => [...current, newRow()])}
          disabled={rows.length >= MAX_BUDGET_ITEMS}
          className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
        >
          Adicionar item
        </button>
      </fieldset>

      <Field id="budget-notes" label="Premissas e observações (opcional)" error={fieldErrors.notes} hint="O que está incluso, o que foi combinado com fornecedores, riscos…">
        <textarea id="budget-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={MAX_NOTES} rows={4} className={inputClass} />
      </Field>

      <div className="ml-auto w-full max-w-sm space-y-1 rounded-lg bg-slate-50 p-3 text-sm" aria-label="Totais">
        {live.totals.byCategory.map((group) => (
          <div key={group.category} className="flex justify-between text-slate-600">
            <span>{categoryLabel(group.category)}</span>
            <span className="tabular-nums" data-testid={`form-subtotal-${group.category}`}>
              {formatBRL(group.subtotalCents)}
            </span>
          </div>
        ))}
        <div className="flex justify-between border-t border-slate-300 pt-1 font-semibold text-slate-900">
          <span>Custo total</span>
          <span className="tabular-nums" data-testid="form-total">
            {formatBRL(live.totals.totalCents)}
          </span>
        </div>
        {revenue && live.margin && (
          <p className={`pt-1 text-xs ${live.margin.marginCents < 0 ? "font-medium text-red-700" : "text-slate-600"}`} data-testid="form-margin">
            Margem prevista sobre {revenue.label.toLowerCase()}: {formatBRL(live.margin.marginCents)}
            {live.margin.marginBps !== null && ` (${formatBps(live.margin.marginBps)})`}
            {live.margin.marginCents < 0 && ", prejuízo"}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className={buttonClass()}
        >
          {submitting ? "Salvando…" : "Salvar orçamento"}
        </button>
        <AppLink href={cancelHref} className={buttonClass({ variant: "ghost" })}>
          Cancelar
        </AppLink>
      </div>
    </form>
  );
}
