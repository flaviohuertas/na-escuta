import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TasksScreen } from "@/components/tasks/TasksScreen";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";

const eventId = "01991b1a-0000-7000-8000-000000000010";
const companyId = "01991b1a-0000-7000-8000-000000000099";
const props = { eventId, userId: "user-1", companyId };

const sync = {
  version: 1,
  syncStatus: "synced" as const,
  createdAt: "2026-09-19T10:00:00.000Z",
  updatedAt: "2026-09-19T10:00:00.000Z",
  deletedAt: null,
  createdBy: null,
  updatedBy: null,
};

async function seedTask(title: string, status: "TODO" | "IN_PROGRESS" | "DONE" | "BLOCKED" = "TODO") {
  await getDb().tasks.put({
    id: `task-${title}`,
    eventId,
    companyId,
    title,
    description: null,
    status,
    priority: 0,
    dueAt: null,
    assignedToUserId: null,
    ...sync,
  });
}

describe("tela de tarefas (telas de campo)", () => {
  beforeEach(() => {
    resetDbInstanceForTests();
  });

  afterEach(async () => {
    cleanup();
    const db = getDb();
    db.close();
    await db.delete();
    resetDbInstanceForTests();
  });

  it("enquanto lê o aparelho mostra 'Carregando…' e só depois diz que não há tarefas", async () => {
    render(<TasksScreen {...props} />);

    // Antes da primeira leitura NÃO pode aparecer "Nenhuma tarefa": a lista ainda nem foi consultada.
    expect(screen.getByRole("status")).toHaveTextContent("Carregando…");
    expect(screen.queryByText("Nenhuma tarefa ainda.")).not.toBeInTheDocument();

    expect(await screen.findByText("Nenhuma tarefa ainda.")).toBeInTheDocument();
    expect(screen.queryByText("Carregando…")).not.toBeInTheDocument();
  });

  it("o botão diz o que vai acontecer: Iniciar → Concluir → Reabrir", async () => {
    const user = userEvent.setup();
    await seedTask("Montar palco");
    render(<TasksScreen {...props} />);

    await user.click(await screen.findByRole("button", { name: "Iniciar tarefa: Montar palco" }));
    await user.click(await screen.findByRole("button", { name: "Concluir tarefa: Montar palco" }));
    // Concluída: o próximo passo do ciclo volta para "A fazer", e o botão diz isso.
    expect(await screen.findByRole("button", { name: "Reabrir tarefa: Montar palco" })).toBeInTheDocument();
    expect(screen.getByText("Concluída")).toBeInTheDocument();
  });

  it("excluir pede confirmação: nada some antes, o foco vai para 'Cancelar' e volta para 'Excluir'", async () => {
    const user = userEvent.setup();
    await seedTask("Montar palco");
    render(<TasksScreen {...props} />);

    const excluir = await screen.findByRole("button", { name: "Excluir tarefa: Montar palco" });
    await user.click(excluir);

    const confirmacao = screen.getByRole("group", { name: "Confirmar exclusão" });
    expect(confirmacao).toBeInTheDocument();
    expect(screen.getByText("Montar palco")).toBeInTheDocument(); // ainda está lá
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("group", { name: "Confirmar exclusão" })).not.toBeInTheDocument();
    expect(excluir).toHaveFocus();
    expect(screen.getByText("Montar palco")).toBeInTheDocument();
  });

  it("confirmar a exclusão tira a tarefa da lista", async () => {
    const user = userEvent.setup();
    await seedTask("Montar palco");
    render(<TasksScreen {...props} />);

    await user.click(await screen.findByRole("button", { name: "Excluir tarefa: Montar palco" }));
    await user.click(screen.getByRole("button", { name: "Excluir tarefa" }));

    await waitFor(() => expect(screen.queryByText("Montar palco")).not.toBeInTheDocument());
    expect(await screen.findByText("Nenhuma tarefa ainda.")).toBeInTheDocument();
  });

  it("tarefa bloqueada não tem botão de avançar", async () => {
    await seedTask("Esperar gerador", "BLOCKED");
    render(<TasksScreen {...props} />);

    expect(await screen.findByText("Esperar gerador")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /tarefa: Esperar gerador/ })).toBeInTheDocument(); // só o Excluir
    expect(screen.queryByRole("button", { name: /^(Iniciar|Concluir|Reabrir)/ })).not.toBeInTheDocument();
  });
});
