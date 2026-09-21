import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChecklistDetailScreen } from "@/components/checklists/ChecklistDetailScreen";
import { getDb, resetDbInstanceForTests } from "@/lib/db/dexie/db";

const eventId = "01991b1a-0000-7000-8000-000000000010";
const companyId = "01991b1a-0000-7000-8000-000000000099";
const checklistId = "chk-1";
const props = { eventId, checklistId, userId: "user-1", companyId };

const sync = {
  version: 1,
  syncStatus: "synced" as const,
  createdAt: "2026-09-19T10:00:00.000Z",
  updatedAt: "2026-09-19T10:00:00.000Z",
  deletedAt: null,
  createdBy: null,
  updatedBy: null,
};

async function seedChecklist() {
  const db = getDb();
  await db.checklists.put({ id: checklistId, eventId, companyId, title: "Montagem do palco", description: null, ...sync });
  const item = (id: string, label: string, order: number, isRequired: boolean, status: "PENDING" | "DONE") => ({
    id,
    checklistId,
    eventId,
    companyId,
    label,
    order,
    isRequired,
    status,
    doneAt: status === "DONE" ? sync.updatedAt : null,
    doneByUserId: null,
    ...sync,
  });
  await db.checklistItems.bulkPut([
    item("i1", "Testar som", 0, true, "DONE"),
    item("i2", "Ligar geradores", 1, false, "PENDING"),
  ]);
}

describe("detalhe do checklist (telas de campo)", () => {
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

  it("mostra quantos itens estão concluídos, escrito (a barra é só reforço)", async () => {
    await seedChecklist();
    render(<ChecklistDetailScreen {...props} />);

    expect(await screen.findByText("1/2 itens concluídos")).toBeInTheDocument();
  });

  it("'Obrigatório' é texto ligado ao item, não um asterisco solto — e não entra no nome dele", async () => {
    await seedChecklist();
    render(<ChecklistDetailScreen {...props} />);

    const required = await screen.findByRole("checkbox", { name: "Testar som" });
    expect(required).toHaveAccessibleDescription("Obrigatório");
    expect(required).toBeChecked();

    const optional = screen.getByRole("checkbox", { name: "Ligar geradores" });
    expect(optional).not.toHaveAccessibleDescription("Obrigatório");
    expect(optional).not.toBeChecked();
  });

  it("tocar no TEXTO do item também marca (a linha inteira é o alvo)", async () => {
    const user = userEvent.setup();
    await seedChecklist();
    render(<ChecklistDetailScreen {...props} />);

    await user.click(await screen.findByText("Ligar geradores"));

    expect(await screen.findByText("2/2 itens concluídos")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Ligar geradores" })).toBeChecked();
  });

  it("sem itens diz o que fazer, em vez de uma lista vazia", async () => {
    await getDb().checklists.put({ id: checklistId, eventId, companyId, title: "Vazio", description: null, ...sync });
    render(<ChecklistDetailScreen {...props} />);

    expect(await screen.findByText("Nenhum item ainda.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
