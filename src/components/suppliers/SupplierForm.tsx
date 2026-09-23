"use client";

import { useRef, useState, type FormEvent } from "react";
import { callApi } from "@/components/admin/api";
import { Field, RequiredNote, inputClass, issuesByField } from "@/components/crm/Field";
import { buttonClass } from "@/components/ui/Button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import { AppLink } from "@/components/ui/AppLink";
import { BUDGET_CATEGORIES } from "@/lib/domain/budget";
import { formatDocument } from "@/lib/domain/crm";
import { MAX_CONTACT_NAME, MAX_SUPPLIER_NAME, MAX_SUPPLIER_NOTES, SUPPLIER_KIND_LABEL, type SupplierKindName } from "@/lib/domain/supplier";
import { SupplierInputSchema, SupplierUpdateSchema } from "@/lib/domain/supplier.schema";
import { navigateToDocument } from "@/lib/offline/navigate";

export interface SupplierFormInitial {
  id: string;
  name: string;
  kind: SupplierKindName;
  document: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  notes: string | null;
  version: number;
}

/**
 * Cadastrar/editar um fornecedor. É uma ação de GESTÃO, feita online: sem rede o formulário diz
 * isso e mantém o que foi digitado. O servidor revalida tudo (papel, empresa, documento duplicado,
 * versão); a tela só valida antes, com o mesmo schema, para não gastar uma ida à rede.
 */
export function SupplierForm({ mode, initial }: { mode: "create" | "edit"; initial?: SupplierFormInitial }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<SupplierKindName>(initial?.kind ?? "COMPANY");
  const [document, setDocument] = useState(formatDocument(initial?.document));
  const [contactName, setContactName] = useState(initial?.contactName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outdated, setOutdated] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, fieldErrors);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setOutdated(false);
    setFieldErrors({});

    const payload = {
      name,
      kind,
      document: document.trim() ? document : null,
      contactName: contactName.trim() ? contactName : null,
      email: email.trim() ? email : null,
      phone: phone.trim() ? phone : null,
      category: category || null,
      notes: notes.trim() ? notes : null,
      ...(mode === "edit" && initial ? { baseVersion: initial.version } : {}),
    };
    const checked = (mode === "edit" ? SupplierUpdateSchema : SupplierInputSchema).safeParse(payload);
    if (!checked.success) {
      setFieldErrors(issuesByField(checked.error.issues));
      return;
    }

    setSubmitting(true);
    const result = await callApi<{ supplier: { id: string } }>(
      mode === "edit" ? "PATCH" : "POST",
      mode === "edit" && initial ? `/api/fornecedores/${initial.id}` : "/api/fornecedores",
      payload
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      // 409 numa edição: outra pessoa mexeu antes — o botão recarrega os dados atuais.
      setOutdated(mode === "edit" && result.status === 409);
      return;
    }
    navigateToDocument(`/fornecedores/${result.data.supplier.id}`);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6 space-y-4" aria-label="Dados do fornecedor">
      <RequiredNote />
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

      <Field id="supplier-name" label="Nome" error={fieldErrors.name} required>
        <input id="supplier-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_SUPPLIER_NAME} className={inputClass} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="supplier-kind" label="Tipo" error={fieldErrors.kind}>
          <select id="supplier-kind" value={kind} onChange={(e) => setKind(e.target.value as SupplierKindName)} className={inputClass}>
            <option value="COMPANY">{SUPPLIER_KIND_LABEL.COMPANY}</option>
            <option value="PERSON">{SUPPLIER_KIND_LABEL.PERSON}</option>
          </select>
        </Field>
        <Field id="supplier-document" label="CPF ou CNPJ (opcional)" error={fieldErrors.document} hint="Com ou sem pontuação. Não pode repetir dentro da empresa.">
          <input id="supplier-document" value={document} onChange={(e) => setDocument(e.target.value)} inputMode="numeric" className={inputClass} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="supplier-contact" label="Pessoa de contato (opcional)" error={fieldErrors.contactName}>
          <input id="supplier-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={MAX_CONTACT_NAME} className={inputClass} />
        </Field>
        <Field id="supplier-category" label="Categoria principal (opcional)" error={fieldErrors.category} hint="Ajuda a achar quem cotar para cada tipo de custo.">
          <select id="supplier-category" value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            <option value="">Sem categoria</option>
            {BUDGET_CATEGORIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="supplier-email" label="E-mail (opcional)" error={fieldErrors.email}>
          <input id="supplier-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field id="supplier-phone" label="Telefone (opcional)" error={fieldErrors.phone}>
          <input id="supplier-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className={inputClass} />
        </Field>
      </div>

      <Field id="supplier-notes" label="Observações (opcional)" error={fieldErrors.notes} hint="Condições, prazos de pagamento, restrições…">
        <textarea id="supplier-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={MAX_SUPPLIER_NOTES} rows={3} className={inputClass} />
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className={buttonClass()}
        >
          {submitting ? "Salvando…" : mode === "edit" ? "Salvar alterações" : "Cadastrar fornecedor"}
        </button>
        <AppLink href="/fornecedores" className={buttonClass({ variant: "ghost" })}>
          Cancelar
        </AppLink>
      </div>
    </form>
  );
}
