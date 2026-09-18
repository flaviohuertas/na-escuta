"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import type { LocalTask } from "@/lib/db/dexie/schema";
import { createTask, deleteTask, updateTask } from "@/lib/repositories/task.repository";
import { getOrCreateDeviceId } from "@/lib/auth/device-id";
import { SyncStatusBadge } from "@/components/sync/SyncStatusBadge";

const STATUS_LABEL: Record<LocalTask["status"], string> = {
  TODO: "A fazer",
  IN_PROGRESS: "Em andamento",
  DONE: "Concluída",
  BLOCKED: "Bloqueada",
};

const STATUS_CYCLE: LocalTask["status"][] = ["TODO", "IN_PROGRESS", "DONE"];

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(iso)
  );
}

export function TasksScreen({
  eventId,
  userId,
  companyId,
}: {
  eventId: string;
  userId: string;
  companyId: string;
}) {
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const tasks = useLiveQuery(
    async () => {
      const db = getDb();
      const rows = await db.tasks.where("eventId").equals(eventId).toArray();
      return rows
        .filter((t) => !t.deletedAt)
        .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, "pt-BR"));
    },
    [eventId],
    [] as LocalTask[]
  );

  function ctx() {
    return { userId, companyId, deviceId: getOrCreateDeviceId() };
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await createTask(
        { eventId, title: title.trim(), dueAt: dueAt ? new Date(dueAt).toISOString() : null },
        ctx()
      );
      setTitle("");
      setDueAt("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Não foi possível criar a tarefa.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cycleStatus(task: LocalTask) {
    const idx = STATUS_CYCLE.indexOf(task.status);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length] ?? "TODO";
    await updateTask(task.id, { status: next }, ctx());
  }

  async function handleDelete(taskId: string) {
    await deleteTask(taskId, ctx());
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href={`/eventos/${eventId}`} className="text-sm text-brand-600 hover:underline">
        ← Voltar ao evento
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-slate-900">Tarefas</h1>

      <form
        onSubmit={handleCreate}
        className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3"
      >
        <div className="min-w-[200px] flex-1">
          <label htmlFor="task-title" className="block text-xs font-medium text-slate-600">
            Nova tarefa
          </label>
          <input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex.: Confirmar fornecedor de som"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            required
          />
        </div>
        <div>
          <label htmlFor="task-due" className="block text-xs font-medium text-slate-600">
            Prazo
          </label>
          <input
            id="task-due"
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          Adicionar
        </button>
      </form>
      {formError && (
        <p role="alert" className="mt-2 text-sm text-status-error">
          {formError}
        </p>
      )}

      <ul className="mt-4 space-y-2">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3"
          >
            <div>
              <p className="font-medium text-slate-900">{task.title}</p>
              <p className="text-xs text-slate-500">
                {STATUS_LABEL[task.status]}
                {task.dueAt ? ` · prazo ${formatDate(task.dueAt)}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SyncStatusBadge status={task.syncStatus} />
              {task.status !== "BLOCKED" && (
                <button
                  type="button"
                  onClick={() => void cycleStatus(task)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
                >
                  Avançar status
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleDelete(task.id)}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs text-status-error hover:bg-red-50"
              >
                Excluir
              </button>
            </div>
          </li>
        ))}
        {tasks.length === 0 && <p className="text-sm text-slate-500">Nenhuma tarefa ainda.</p>}
      </ul>
    </div>
  );
}
