"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { compactSelectClass, inputClass } from "@/components/ui/Field";
import { COMPANY_ROLE_LABEL } from "@/lib/domain/event-labels";
import { AddMemberSchema } from "@/lib/domain/team.schema";
import { callApi } from "./api";

export interface TeamRow {
  membershipId: string;
  name: string;
  email: string;
  role: string;
  status: "ACTIVE" | "REVOKED";
  mustChangePassword: boolean;
  isSelf: boolean;
  canModify: boolean;
}

interface TemporaryPassword {
  name: string;
  email: string;
  password: string;
  kind: "created" | "reset";
}

const selectClass = compactSelectClass;

/**
 * A equipe da empresa. Cada ação é uma ida ao servidor, que revalida tudo (hierarquia de papéis,
 * "não altera a si mesmo", evento nunca sem gestor); a tela só mostra o que ele responde.
 * A senha provisória é mostrada UMA vez, aqui, e nunca fica guardada em lugar nenhum.
 */
export function TeamManager({ members, assignableRoles }: { members: TeamRow[]; assignableRoles: string[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(assignableRoles.includes("STAFF") ? "STAFF" : (assignableRoles[0] ?? ""));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [temp, setTemp] = useState<TemporaryPassword | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<{ id: string; kind: "revoke" | "reset" } | null>(null);

  function reset() {
    setError(null);
    setNotice(null);
    setTemp(null);
    setCopied(false);
    setConfirming(null);
  }

  async function onAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    reset();
    setFieldErrors({});

    const checked = AddMemberSchema.safeParse({ name, email, role });
    if (!checked.success) {
      const problems: Partial<Record<string, string>> = {};
      for (const issue of checked.error.issues) {
        const field = String(issue.path[0] ?? "");
        problems[field] ??= issue.message;
      }
      setFieldErrors(problems);
      return;
    }

    setBusy("add");
    const result = await callApi<{ temporaryPassword: string | null }>("POST", "/api/equipe", checked.data);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (result.data.temporaryPassword) {
      setTemp({ name: checked.data.name, email: checked.data.email, password: result.data.temporaryPassword, kind: "created" });
    } else {
      setNotice(`${checked.data.name} foi vinculada à equipe. Ela já tinha conta, então a senha dela não muda.`);
    }
    setName("");
    setEmail("");
    router.refresh();
  }

  async function onChange(row: TeamRow, patch: { role?: string; status?: "ACTIVE" | "REVOKED" }, done: string) {
    reset();
    setBusy(row.membershipId);
    const result = await callApi("PATCH", `/api/equipe/${row.membershipId}`, patch);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice(done);
    router.refresh();
  }

  async function onResetPassword(row: TeamRow) {
    reset();
    setBusy(row.membershipId);
    const result = await callApi<{ temporaryPassword: string }>("POST", `/api/equipe/${row.membershipId}/senha`);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setTemp({ name: row.name, email: row.email, password: result.data.temporaryPassword, kind: "reset" });
    router.refresh();
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false); // sem permissão de área de transferência: a pessoa copia à mão
    }
  }

  return (
    <div className="mt-6 space-y-8">
      <div aria-live="polite" className="space-y-3">
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {notice && !error && (
          <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice}
          </p>
        )}
        {temp && (
          <div data-testid="temp-password-panel" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p>
              {temp.kind === "created" ? "Conta criada para" : "Nova senha provisória de"} <strong>{temp.name}</strong> ({temp.email}).
              Senha provisória:
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code data-testid="temp-password" className="select-all rounded bg-white px-3 py-1.5 font-mono text-base tracking-wide">
                {temp.password}
              </code>
              <button
                type="button"
                onClick={() => void copy(temp.password)}
                className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm hover:bg-amber-100"
              >
                {copied ? "Copiado" : "Copiar"}
              </button>
              <button
                type="button"
                onClick={() => setTemp(null)}
                className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm hover:bg-amber-100"
              >
                Já anotei
              </button>
            </div>
            <p className="mt-2">
              Entregue à pessoa agora: <strong>por segurança, esta senha não aparece de novo.</strong> No primeiro acesso
              ela será obrigada a criar uma senha própria.
            </p>
          </div>
        )}
      </div>

      <section aria-labelledby="add-person">
        <h2 id="add-person" className="text-base font-semibold text-slate-900">
          Adicionar pessoa
        </h2>
        <form onSubmit={onAdd} noValidate aria-label="Adicionar pessoa" className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="member-name" className="block text-sm font-medium text-slate-700">
              Nome
            </label>
            <input id="member-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            {fieldErrors.name && (
              <p role="alert" className="mt-1 text-sm text-red-700">
                {fieldErrors.name}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="member-email" className="block text-sm font-medium text-slate-700">
              E-mail
            </label>
            <input
              id="member-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
            {fieldErrors.email && (
              <p role="alert" className="mt-1 text-sm text-red-700">
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="member-role" className="block text-sm font-medium text-slate-700">
              Papel na empresa
            </label>
            <select
              id="member-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={`${selectClass} mt-1 w-full py-2`}
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>
                  {COMPANY_ROLE_LABEL[r] ?? r}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={busy === "add"}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {busy === "add" ? "Adicionando…" : "Adicionar"}
            </button>
          </div>
        </form>
        <p className="mt-2 text-xs text-slate-500">
          A pessoa recebe uma senha provisória (mostrada uma vez, aqui) e precisa trocá-la no primeiro acesso. Depois,
          dê a ela acesso a cada evento na tela “Pessoas” do evento.
        </p>
      </section>

      <section aria-labelledby="team-list">
        <h2 id="team-list" className="text-base font-semibold text-slate-900">
          Equipe
        </h2>
        <ul className="mt-2 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {members.map((row) => {
            const active = row.status === "ACTIVE";
            const rowBusy = busy === row.membershipId;
            const isConfirming = confirming?.id === row.membershipId;
            return (
              <li key={row.membershipId} className="p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {row.name}
                      {row.isSelf && <span className="ml-2 text-xs font-normal text-slate-500">(você)</span>}
                    </p>
                    <p className="text-sm text-slate-500">{row.email}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {!active && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Vínculo encerrado</span>
                      )}
                      {active && row.mustChangePassword && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                          Senha provisória pendente
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {row.canModify && active ? (
                      <select
                        aria-label={`Papel de ${row.name} na empresa`}
                        value={row.role}
                        disabled={rowBusy}
                        onChange={(e) => void onChange(row, { role: e.target.value }, "Papel atualizado.")}
                        className={selectClass}
                      >
                        {assignableRoles.map((r) => (
                          <option key={r} value={r}>
                            {COMPANY_ROLE_LABEL[r] ?? r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {COMPANY_ROLE_LABEL[row.role] ?? row.role}
                      </span>
                    )}

                    {row.canModify && active && !isConfirming && (
                      <>
                        <button
                          type="button"
                          disabled={rowBusy}
                          onClick={() => setConfirming({ id: row.membershipId, kind: "reset" })}
                          aria-label={`Redefinir a senha de ${row.name}`}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                        >
                          Redefinir senha
                        </button>
                        <button
                          type="button"
                          disabled={rowBusy}
                          onClick={() => setConfirming({ id: row.membershipId, kind: "revoke" })}
                          aria-label={`Encerrar o vínculo de ${row.name}`}
                          className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          Encerrar vínculo
                        </button>
                      </>
                    )}

                    {row.canModify && !active && (
                      <button
                        type="button"
                        disabled={rowBusy}
                        onClick={() => void onChange(row, { status: "ACTIVE" }, "Vínculo reativado. Os acessos a eventos não voltam sozinhos: dê acesso de novo onde for preciso.")}
                        aria-label={`Reativar o vínculo de ${row.name}`}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Reativar
                      </button>
                    )}
                  </div>
                </div>

                {isConfirming && (
                  <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-800">
                    {confirming!.kind === "revoke" ? (
                      <p>
                        Encerrar o vínculo de <strong>{row.name}</strong>? Ela deixa de entrar na empresa e{" "}
                        <strong>perde o acesso a todos os eventos</strong> (o acesso não volta sozinho se você reativá-la depois).
                        Os aparelhos dela tiram de si os dados da empresa assim que se conectarem; só ficam as alterações
                        que ela ainda não enviou, para ela exportar ou descartar.
                      </p>
                    ) : (
                      <p>
                        Redefinir a senha de <strong>{row.name}</strong>? A senha atual deixa de valer, ela sai de todos os
                        aparelhos em que estiver conectada e precisará criar outra no próximo acesso. Os dados já
                        baixados num aparelho perdido continuam lá — para que ele se limpe assim que se conectar,
                        encerre o vínculo.
                      </p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          confirming!.kind === "revoke"
                            ? void onChange(row, { status: "REVOKED" }, "Vínculo encerrado e acessos retirados.")
                            : void onResetPassword(row)
                        }
                        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
