"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { callApi } from "@/components/admin/api";
import { Field, inputClass, issuesByField } from "@/components/crm/Field";
import { AppLink } from "@/components/ui/AppLink";
import { SupplierSelect, type SupplierChoice } from "@/components/suppliers/SupplierSelect";
import { BUDGET_CATEGORIES, MAX_ITEM_DESCRIPTION, MAX_SUPPLIER } from "@/lib/domain/budget";
import { centsToInput, parseBRLToCents } from "@/lib/domain/crm";
import { MAX_EXPENSE_NOTES } from "@/lib/domain/finance";
import { ExpenseInputSchema, ExpenseUpdateSchema } from "@/lib/domain/finance.schema";
import { navigateToDocument } from "@/lib/offline/navigate";

export interface ExpenseFormInitial {
  id: string;
  category: string;
  description: string;
  supplier: string | null;
  supplierId?: string | null;
  amountCents: number;
  /** "2027-01-10" */
  expenseDate: string;
  notes: string | null;
  version: number;
}

/**
 * Lançar (ou editar) um custo realizado. O valor é digitado em reais ("3.000,00") e vai em
 * CENTAVOS inteiros. Criar deixa a pessoa na mesma tela (limpa o formulário e atualiza a lista, para
 * lançar vários em sequência); editar volta para o evento. Se outra pessoa mexeu antes (409), a tela
 * oferece carregar os dados atuais em vez de sobrescrever.
 */
export function ExpenseForm({
  mode,
  eventId,
  defaultDate,
  initial,
  suppliers = [],
}: {
  mode: "create" | "edit";
  eventId: string;
  /** Os fornecedores do cadastro para escolher (vazio: só o texto livre). */
  suppliers?: readonly SupplierChoice[];
  /** O dia de hoje em Brasília ("2027-01-10"), a data padrão de um lançamento novo. */
  defaultDate: string;
  initial?: ExpenseFormInitial;
}) {
  const router = useRouter();
  const [category, setCategory] = useState(initial?.category ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [supplier, setSupplier] = useState(initial?.supplier ?? "");
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [amount, setAmount] = useState(initial ? centsToInput(initial.amountCents) : "");
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate ?? defaultDate);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [outdated, setOutdated] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const back = `/financeiro/eventos/${eventId}`;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setOutdated(false);
    setFieldErrors({});

    const cents = parseBRLToCents(amount);
    if (cents === null) {
      setFieldErrors({ amountCents: amount.trim() ? "Informe o valor como 3.000,00 (vírgula nos centavos)." : "Informe o valor do lançamento." });
      return;
    }

    const payload = {
      category,
      description,
      // Com fornecedor do cadastro vale o vínculo (o servidor guarda o nome dele); sem, o texto digitado.
      supplier: supplierId ? null : supplier.trim() ? supplier : null,
      supplierId: supplierId || null,
      amountCents: cents,
      expenseDate,
      notes: notes.trim() ? notes : null,
      ...(mode === "edit" && initial ? { baseVersion: initial.version } : {}),
    };
    const checked = (mode === "edit" ? ExpenseUpdateSchema : ExpenseInputSchema).safeParse(payload);
    if (!checked.success) {
      setFieldErrors(issuesByField(checked.error.issues));
      return;
    }

    setSubmitting(true);
    const result = await callApi(
      mode === "edit" ? "PATCH" : "POST",
      mode === "edit" && initial ? `/api/financeiro/lancamentos/${initial.id}` : `/api/financeiro/eventos/${eventId}/lancamentos`,
      payload
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      setOutdated(mode === "edit" && result.status === 409);
      return;
    }

    if (mode === "edit") {
      navigateToDocument(back);
      return;
    }
    // Criar: fica na tela, limpa o que é do lançamento (mantém a data e a categoria para o próximo) e atualiza a lista.
    setDescription("");
    setSupplier("");
    setSupplierId("");
    setAmount("");
    setNotes("");
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-3 space-y-4" aria-label={mode === "edit" ? "Editar lançamento" : "Novo lançamento"}>
      {error && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          <p>{error}</p>
          {outdated && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 rounded-md border border-red-300 bg-white px-3 py-1 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              Carregar os dados atuais
            </button>
          )}
        </div>
      )}
      {saved && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Lançamento salvo.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="expense-category" label="Categoria" error={fieldErrors.category}>
          <select id="expense-category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            <option value="">Escolha…</option>
            {BUDGET_CATEGORIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="expense-date" label="Data do custo" error={fieldErrors.expenseDate}>
          <input id="expense-date" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className={inputClass} />
        </Field>
      </div>

      <Field id="expense-description" label="Descrição" error={fieldErrors.description}>
        <input id="expense-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={MAX_ITEM_DESCRIPTION} className={inputClass} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="expense-amount" label="Valor (R$)" error={fieldErrors.amountCents} hint="Ex.: 3.000,00">
          <input id="expense-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={inputClass} />
        </Field>
        <Field id="expense-supplier" label="Fornecedor (opcional)" error={fieldErrors.supplier ?? fieldErrors.supplierId}>
          {suppliers.length > 0 ? (
            <>
              {/* Um do cadastro (vincula pelo id) ou, sem cadastro, o nome digitado. */}
              <SupplierSelect id="expense-supplier" label="Fornecedor cadastrado" suppliers={suppliers} value={supplierId} onChange={setSupplierId} />
              {!supplierId && (
                <input aria-label="Nome do fornecedor (não cadastrado)" value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={MAX_SUPPLIER} className={inputClass} />
              )}
            </>
          ) : (
            <input id="expense-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={MAX_SUPPLIER} className={inputClass} />
          )}
        </Field>
      </div>

      <Field id="expense-notes" label="Observações (opcional)" error={fieldErrors.notes}>
        <textarea id="expense-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={MAX_EXPENSE_NOTES} rows={2} className={inputClass} />
      </Field>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
        >
          {submitting ? "Salvando…" : mode === "edit" ? "Salvar alterações" : "Lançar custo"}
        </button>
        {mode === "edit" && (
          <AppLink href={back} className="text-sm text-slate-600 hover:text-slate-900">
            Cancelar
          </AppLink>
        )}
      </div>
    </form>
  );
}
