"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { compactSelectClass, inputClass } from "@/components/ui/Field";
import { COMPANY_ROLE_LABEL } from "@/lib/domain/event-labels";
import { AddMemberSchema } from "@/lib/domain/team.schema";
import { callApi } from "./api";
import { buttonClass } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export interface TeamRow {
  membershipId: string;
  name: string;
  email: string;
  role: string;
  status: "ACTIVE" | "REVOKED";
  isActive: boolean;
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
  const [confirming, setConfirming] = useState<{ id: string; kind: "revoke" | "reset" | "toggle-account" } | null>(null);

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

  async function onChange(row: TeamRow, patch: { role?: string; status?: "ACTIVE" | "REVOKED"; isActive?: boolean }, done: string) {
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
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {notice && !error && (
          <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
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
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {copied ? "Copiado" : "Copiar"}
              </button>
              <button
                type="button"
                onClick={() => setTemp(null)}
                className={buttonClass({ variant: "secondary", size: "sm" })}
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
              className={buttonClass()}
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
        <ul className="mt-2 divide-y divide-slate-200 rounded-xl border border-line bg-white">
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
                      {!active && <Badge tone="neutral">Vínculo encerrado</Badge>}
                      {active && row.mustChangePassword && <Badge tone="warning">Senha provisória pendente</Badge>}
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
                      <Badge tone="neutral">{COMPANY_ROLE_LABEL[row.role] ?? row.role}</Badge>
                    )}

                    {row.canModify && active && !isConfirming && (
                      <>
                        <button
                          type="button"
                          disabled={rowBusy}
                          onClick={() => setConfirming({ id: row.membershipId, kind: "toggle-account" })}
                          aria-label={row.isActive ? `Desativar a conta de ${row.name}` : `Reativar a conta de ${row.name}`}
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          {row.isActive ? "Desativar conta" : "Reativar conta"}
                        </button>
                        <button
                          type="button"
                          disabled={rowBusy}
                          onClick={() => setConfirming({ id: row.membershipId, kind: "reset" })}
                          aria-label={`Redefinir a senha de ${row.name}`}
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                        >
                          Redefinir senha
                        </button>
                        <button
                          type="button"
                          disabled={rowBusy}
                          onClick={() => setConfirming({ id: row.membershipId, kind: "revoke" })}
                          aria-label={`Encerrar o vínculo de ${row.name}`}
                          className={buttonClass({ variant: "ghost-danger", size: "sm" })}
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
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        Reativar
                      </button>
                    )}
                  </div>
                </div>

                {isConfirming && (
                  <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">
                    {confirming!.kind === "revoke" ? (
                      <p>
                        Encerrar o vínculo de <strong>{row.name}</strong>? Ela deixa de entrar na empresa e{" "}
                        <strong>perde o acesso a todos os eventos</strong> (o acesso não volta sozinho se você reativá-la depois).
                        Os aparelhos dela tiram de si os dados da empresa assim que se conectarem; só ficam as alterações
                        que ela ainda não enviou, para ela exportar ou descartar.
                      </p>
                    ) : confirming!.kind === "toggle-account" ? (
                      <p>
                        {row.isActive ? "Desativar" : "Reativar"} a conta de <strong>{row.name}</strong>?{" "}
                        {row.isActive
                          ? "Ela deixa de entrar em qualquer empresa e os aparelhos dela passam a receber "
                            + "o veredito de conta desativada quando se conectarem."
                          : "Ela volta a poder entrar com a senha atual, mas o vínculo da empresa continua o mesmo."}
                      </p>
                    ) : (
                      <p>
                        Redefinir a senha de <strong>{row.name}</strong>? A senha atual deixa de valer, ela sai de todos os
                        aparelhos em que estiver conectada e precisará criar outra no próximo acesso. Os dados já
                        baixados num aparelho perdido continuam lá. Para que ele se limpe assim que se conectar,
                        encerre o vínculo.
                      </p>
                    )}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          confirming!.kind === "revoke"
                            ? void onChange(row, { status: "REVOKED" }, "Vínculo encerrado e acessos retirados.")
                            : confirming!.kind === "toggle-account"
                              ? void onChange(row, { isActive: !row.isActive }, row.isActive ? "Conta desativada." : "Conta reativada.")
                              : void onResetPassword(row)
                        }
                        className={buttonClass({ size: "sm" })}
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
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
