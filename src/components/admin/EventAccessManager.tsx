"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { compactSelectClass } from "@/components/ui/Field";
import { COMPANY_ROLE_LABEL, EVENT_ROLE_LABEL } from "@/lib/domain/event-labels";
import { EVENT_ROLES, type EventRoleName } from "@/lib/domain/permissions";
import { callApi } from "./api";
import { buttonClass } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export interface AccessRow {
  userId: string;
  name: string;
  email: string;
  role: EventRoleName;
  status: "ACTIVE" | "REVOKED";
  membershipActive: boolean;
}

export interface AccessCandidate {
  userId: string;
  name: string;
  email: string;
  companyRole: string;
}

const selectClass = compactSelectClass;

/**
 * Quem tem acesso a este evento, e a que papel. Cada ação é uma ida ao servidor (que revalida
 * tudo: só o gestor do evento mexe, e o evento nunca fica sem gestor); a tela só reflete a resposta.
 */
export function EventAccessManager({
  eventId,
  rows,
  candidates,
}: {
  eventId: string;
  rows: AccessRow[];
  candidates: AccessCandidate[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [newRole, setNewRole] = useState<EventRoleName>("FIELD_STAFF");

  async function run(key: string, action: () => Promise<{ ok: boolean; message?: string }>, done: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      setError(result.message ?? "Não foi possível concluir a ação.");
      return;
    }
    setNotice(done);
    router.refresh();
  }

  const grant = () =>
    run(
      "grant",
      async () => {
        const res = await callApi("POST", `/api/eventos/${eventId}/acessos`, { userId: candidateId, role: newRole });
        if (res.ok) setCandidateId("");
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      },
      "Acesso concedido."
    );

  const change = (row: AccessRow, patch: { role?: EventRoleName; status?: "ACTIVE" | "REVOKED" }, done: string) =>
    run(
      `row-${row.userId}`,
      async () => {
        const res = await callApi("PATCH", `/api/eventos/${eventId}/acessos/${row.userId}`, patch);
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      },
      done
    );

  return (
    <div className="mt-6 space-y-8">
      <div aria-live="polite">
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
      </div>

      <section aria-labelledby="give-access">
        <h2 id="give-access" className="text-base font-semibold text-slate-900">
          Dar acesso
        </h2>
        {candidates.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            Todas as pessoas ativas da empresa já têm acesso a este evento. Para incluir alguém novo, a
            administração da empresa precisa cadastrá-la antes.
          </p>
        ) : (
          <form
            className="mt-2 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (candidateId) void grant();
            }}
          >
            <div className="w-full min-w-0 sm:w-auto">
              <label htmlFor="access-person" className="block text-sm font-medium text-slate-700">
                Pessoa
              </label>
              <select
                id="access-person"
                value={candidateId}
                onChange={(e) => setCandidateId(e.target.value)}
                className={`${selectClass} mt-1 w-full max-w-full sm:w-auto sm:min-w-64`}
              >
                <option value="">Escolha…</option>
                {candidates.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.name} · {c.email} ({COMPANY_ROLE_LABEL[c.companyRole] ?? c.companyRole})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="access-role" className="block text-sm font-medium text-slate-700">
                Papel no evento
              </label>
              <select
                id="access-role"
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as EventRoleName)}
                className={`${selectClass} mt-1`}
              >
                {EVENT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {EVENT_ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={!candidateId || busy === "grant"}
              className={buttonClass()}
            >
              {busy === "grant" ? "Concedendo…" : "Dar acesso"}
            </button>
          </form>
        )}
      </section>

      <section aria-labelledby="who-has-access">
        <h2 id="who-has-access" className="text-base font-semibold text-slate-900">
          Quem tem acesso
        </h2>
        <ul className="mt-2 divide-y divide-slate-200 rounded-xl border border-line bg-white">
          {rows.map((row) => {
            const active = row.status === "ACTIVE";
            const rowBusy = busy === `row-${row.userId}`;
            return (
              <li key={row.userId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{row.name}</p>
                  <p className="text-sm text-slate-500">{row.email}</p>
                  {!row.membershipActive && (
                    <p className="mt-1 text-xs text-amber-700">
                      Sem vínculo ativo com a empresa: o acesso ao evento não funciona.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {active ? (
                    <>
                      <select
                        aria-label={`Papel de ${row.name} no evento`}
                        value={row.role}
                        disabled={rowBusy}
                        onChange={(e) =>
                          void change(row, { role: e.target.value as EventRoleName }, "Papel atualizado.")
                        }
                        className={selectClass}
                      >
                        {EVENT_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {EVENT_ROLE_LABEL[r]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={rowBusy}
                        onClick={() => void change(row, { status: "REVOKED" }, "Acesso retirado.")}
                        aria-label={`Retirar o acesso de ${row.name}`}
                        className={buttonClass({ variant: "ghost-danger", size: "sm" })}
                      >
                        Retirar acesso
                      </button>
                    </>
                  ) : (
                    <>
                      <Badge tone="neutral">Acesso retirado</Badge>
                      <button
                        type="button"
                        disabled={rowBusy || !row.membershipActive}
                        onClick={() => void change(row, { status: "ACTIVE" }, "Acesso reativado.")}
                        aria-label={`Reativar o acesso de ${row.name}`}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        Reativar
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
