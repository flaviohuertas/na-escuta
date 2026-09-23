"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db/dexie/db";
import type { LocalTask } from "@/lib/db/dexie/schema";
import { createTask, deleteTask, updateTask } from "@/lib/repositories/task.repository";
import { getOrCreateDeviceId } from "@/lib/auth/device-id";
import { SyncStatusBadge } from "@/components/sync/SyncStatusBadge";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, LoadingLine } from "@/components/ui/EmptyState";
import { Field, inputClass } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";

const STATUS_LABEL: Record<LocalTask["status"], string> = {
  TODO: "A fazer",
  IN_PROGRESS: "Em andamento",
  DONE: "Concluída",
  BLOCKED: "Bloqueada",
};

const STATUS_TONE: Record<LocalTask["status"], BadgeTone> = {
  TODO: "neutral",
  IN_PROGRESS: "brand",
  DONE: "success",
  BLOCKED: "danger",
};

const STATUS_CYCLE: LocalTask["status"][] = ["TODO", "IN_PROGRESS", "DONE"];

/** O botão diz o que vai acontecer com a tarefa, não só "avançar". */
const ADVANCE_LABEL: Record<LocalTask["status"], string> = {
  TODO: "Iniciar",
  IN_PROGRESS: "Concluir",
  DONE: "Reabrir",
  BLOCKED: "",
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(iso)
  );
}

/**
 * Uma tarefa. Excluir pede confirmação: o botão fica ao lado de "Iniciar" e, no celular, um toque
 * errado apagaria o trabalho de alguém (a exclusão sincroniza para os outros aparelhos).
 */
function TaskItem({
  task,
  onAdvance,
  onDelete,
}: {
  task: LocalTask;
  onAdvance: (task: LocalTask) => void;
  onDelete: (taskId: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Ao abrir a confirmação, o foco vai para a opção segura (Cancelar); ao cancelar, volta para "Excluir".
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  function cancel() {
    setConfirming(false);
    deleteRef.current?.focus();
  }

  const due = formatDate(task.dueAt);
  const advanceLabel = ADVANCE_LABEL[task.status];

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 [overflow-wrap:anywhere]">{task.title}</p>
          <p className="mt-1 text-sm text-slate-600">{due ? `Prazo ${due}` : "Sem prazo"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Badge>
          <SyncStatusBadge status={task.syncStatus} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {task.status !== "BLOCKED" && (
          <Button
            variant="secondary"
            aria-label={`${advanceLabel} tarefa: ${task.title}`}
            onClick={() => onAdvance(task)}
          >
            {advanceLabel}
          </Button>
        )}
        <Button
          ref={deleteRef}
          variant="ghost-danger"
          aria-label={`Excluir tarefa: ${task.title}`}
          aria-expanded={confirming}
          onClick={() => setConfirming(true)}
        >
          Excluir
        </Button>
      </div>

      {confirming && (
        <div role="group" aria-label="Confirmar exclusão" className="mt-3 rounded-lg bg-red-50 p-3">
          <p className="text-sm text-red-900">Excluir esta tarefa? Ela some também dos outros aparelhos quando sincronizar.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => onDelete(task.id)}>
              Excluir tarefa
            </Button>
            <Button ref={cancelRef} variant="secondary" onClick={cancel}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </Card>
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

  // `undefined` = o aparelho ainda está lendo; a lista vazia só aparece depois da leitura.
  const tasks = useLiveQuery(async () => {
    const db = getDb();
    const rows = await db.tasks.where("eventId").equals(eventId).toArray();
    return rows
      .filter((t) => !t.deletedAt)
      .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title, "pt-BR"));
  }, [eventId]);

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
    <div className="max-w-2xl">
      <PageHeader title="Tarefas" back={{ href: `/eventos/${eventId}`, label: "Voltar ao evento" }} />

      <Card className="mt-4">
        <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <Field id="task-title" label="Nova tarefa">
            <input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Confirmar fornecedor de som"
              className={inputClass}
              required
            />
          </Field>
          <Field id="task-due" label="Prazo">
            <input id="task-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={inputClass} />
          </Field>
          <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
            Adicionar
          </Button>
        </form>
        {formError && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        )}
      </Card>

      <div className="mt-4">
        {tasks === undefined ? (
          <LoadingLine />
        ) : tasks.length === 0 ? (
          <EmptyState hint="Use o campo acima para criar a primeira.">Nenhuma tarefa ainda.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {tasks.map((task) => (
              <li key={task.id}>
                <TaskItem task={task} onAdvance={(t) => void cycleStatus(t)} onDelete={(id) => void handleDelete(id)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
