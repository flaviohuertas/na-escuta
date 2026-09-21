"use client";

import { useRef, useState, type FormEvent } from "react";
import { callApi } from "@/components/admin/api";
import { AppLink } from "@/components/ui/AppLink";
import { Field, RequiredNote, inputClass, issuesByField } from "@/components/crm/Field";
import { buttonClass } from "@/components/ui/Button";
import { useFocusFirstInvalid } from "@/components/ui/use-focus-first-invalid";
import { formatDocument } from "@/lib/domain/crm";
import { ClientInputSchema, ClientUpdateSchema } from "@/lib/domain/crm.schema";
import { navigateToDocument } from "@/lib/offline/navigate";

export interface ClientFormInitial {
  id: string;
  name: string;
  kind: "COMPANY" | "PERSON";
  document: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  version: number;
}

/**
 * Cadastrar/editar um cliente. É uma ação de GESTÃO, feita online: sem rede o formulário diz isso
 * e mantém o que foi digitado. O servidor revalida tudo (papel, empresa, documento duplicado,
 * versão); a tela só valida antes, com o mesmo schema, para não gastar uma ida à rede.
 */
export function ClientForm({ mode, initial }: { mode: "create" | "edit"; initial?: ClientFormInitial }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [kind, setKind] = useState<"COMPANY" | "PERSON">(initial?.kind ?? "COMPANY");
  const [document, setDocument] = useState(formatDocument(initial?.document));
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
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
      email: email.trim() ? email : null,
      phone: phone.trim() ? phone : null,
      notes: notes.trim() ? notes : null,
      ...(mode === "edit" && initial ? { baseVersion: initial.version } : {}),
    };
    const checked = (mode === "edit" ? ClientUpdateSchema : ClientInputSchema).safeParse(payload);
    if (!checked.success) {
      setFieldErrors(issuesByField(checked.error.issues));
      return;
    }

    setSubmitting(true);
    const result = await callApi<{ client: { id: string } }>(
      mode === "edit" ? "PATCH" : "POST",
      mode === "edit" && initial ? `/api/comercial/clientes/${initial.id}` : "/api/comercial/clientes",
      payload
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      // 409 numa edição: outra pessoa mexeu antes — o botão recarrega os dados atuais.
      setOutdated(mode === "edit" && result.status === 409);
      return;
    }
    navigateToDocument(`/comercial/clientes/${result.data.client.id}`);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6 space-y-4" aria-label="Dados do cliente">
      <RequiredNote />
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

      <Field id="client-name" label="Nome" error={fieldErrors.name} required>
        <input id="client-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} className={inputClass} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="client-kind" label="Tipo" error={fieldErrors.kind}>
          <select id="client-kind" value={kind} onChange={(e) => setKind(e.target.value as "COMPANY" | "PERSON")} className={inputClass}>
            <option value="COMPANY">Empresa</option>
            <option value="PERSON">Pessoa</option>
          </select>
        </Field>
        <Field id="client-document" label="CPF ou CNPJ (opcional)" error={fieldErrors.document} hint="Com ou sem pontuação. Não pode repetir dentro da empresa.">
          <input id="client-document" value={document} onChange={(e) => setDocument(e.target.value)} inputMode="numeric" className={inputClass} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="client-email" label="E-mail (opcional)" error={fieldErrors.email}>
          <input id="client-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field id="client-phone" label="Telefone (opcional)" error={fieldErrors.phone}>
          <input id="client-phone" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} className={inputClass} />
        </Field>
      </div>

      <Field id="client-notes" label="Observações (opcional)" error={fieldErrors.notes}>
        <textarea id="client-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} className={inputClass} />
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className={buttonClass()}
        >
          {submitting ? "Salvando…" : mode === "edit" ? "Salvar alterações" : "Cadastrar cliente"}
        </button>
        <AppLink href="/comercial/clientes" className={buttonClass({ variant: "ghost" })}>
          Cancelar
        </AppLink>
      </div>
    </form>
  );
}
