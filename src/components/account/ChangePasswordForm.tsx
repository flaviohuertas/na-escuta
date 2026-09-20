"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import { AppLink } from "@/components/ui/AppLink";
import { callApi } from "@/components/admin/api";
import { ChangePasswordSchema } from "@/lib/domain/password.schema";
import { navigateToDocument } from "@/lib/offline/navigate";

const inputClass =
  "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";

/**
 * Trocar a própria senha. Com `forced`, é a senha PROVISÓRIA que a administração entregou: a
 * pessoa só segue para o app depois de criar a dela.
 */
export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const checked = ChangePasswordSchema.safeParse({ currentPassword, newPassword });
    const problems: Partial<Record<string, string>> = {};
    if (!checked.success) {
      for (const [field, messages] of Object.entries(z.flattenError(checked.error).fieldErrors)) {
        problems[field] = (messages as string[] | undefined)?.[0];
      }
    }
    if (confirmPassword !== newPassword) problems.confirmPassword = "As senhas não conferem.";
    if (Object.keys(problems).length > 0) {
      setFieldErrors(problems);
      return;
    }

    setSubmitting(true);
    const result = await callApi("POST", "/api/conta/senha", { currentPassword, newPassword });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Navegação de documento: o shell do app relê a conta e o bloqueio da senha provisória cai.
    navigateToDocument("/eventos");
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4" aria-label="Trocar senha">
      {forced ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Você entrou com uma senha provisória. Por segurança, crie a sua própria senha antes de continuar.
        </p>
      ) : (
        <p className="text-sm text-slate-500">Informe a senha atual e escolha a nova.</p>
      )}

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Field id="current-password" label={forced ? "Senha provisória" : "Senha atual"} error={fieldErrors.currentPassword}>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field id="new-password" label="Nova senha" error={fieldErrors.newPassword} hint="Pelo menos 10 caracteres.">
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field id="confirm-password" label="Repita a nova senha" error={fieldErrors.confirmPassword}>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={inputClass}
        />
      </Field>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60"
        >
          {submitting ? "Salvando…" : "Salvar nova senha"}
        </button>
        {!forced && (
          <AppLink href="/eventos" className="text-sm text-slate-600 hover:text-slate-900">
            Cancelar
          </AppLink>
        )}
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
