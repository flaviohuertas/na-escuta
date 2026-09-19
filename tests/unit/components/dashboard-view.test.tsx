import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardView } from "@/components/dashboard/DashboardView";
import {
  buildAgenda,
  buildPortfolio,
  emptyMetrics,
  type DashboardEvent,
} from "@/lib/domain/dashboard";

const NOW = new Date("2026-09-18T15:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function event(overrides: Partial<DashboardEvent> & Pick<DashboardEvent, "id" | "name">): DashboardEvent {
  return {
    location: "Parque da Cidade",
    startDate: new Date(NOW.getTime() + 5 * DAY),
    endDate: new Date(NOW.getTime() + 6 * DAY),
    status: "CONFIRMED",
    ...overrides,
  };
}

describe("DashboardView", () => {
  it("mostra estado vazio quando o usuário não tem eventos", () => {
    render(<DashboardView portfolio={buildPortfolio([], NOW)} agenda={[]} generatedAt={NOW} />);
    expect(screen.getByText("Você ainda não tem acesso a nenhum evento.")).toBeTruthy();
    expect(screen.queryByText("Tarefas atrasadas")).toBeNull();
  });

  it("renderiza KPIs, agenda e portfólio, explicando os motivos da saúde do evento", () => {
    const festival = event({ id: "e1", name: "Festival Demo" });
    const encerrado = event({
      id: "e2",
      name: "Show Antigo",
      startDate: new Date(NOW.getTime() - 9 * DAY),
      endDate: new Date(NOW.getTime() - 8 * DAY),
    });
    const metrics = {
      ...emptyMetrics(),
      tasksOpen: 3,
      tasksDone: 1,
      tasksOverdue: 2,
      occurrencesOpen: 1,
      occurrencesOpenHigh: 1,
      occurrencesOpenCritical: 1,
    };
    const portfolio = buildPortfolio(
      [
        { event: festival, role: "MANAGER", metrics },
        { event: encerrado, role: "VIEWER", metrics: emptyMetrics() },
      ],
      NOW
    );
    const agenda = buildAgenda({
      events: [festival, encerrado],
      tasks: [{ id: "t1", eventId: "e1", title: "Confirmar som", status: "TODO", dueAt: new Date(NOW.getTime() - DAY) }],
      now: NOW,
    });

    render(<DashboardView portfolio={portfolio} agenda={agenda} generatedAt={NOW} />);

    // KPIs (o valor 2 = tarefas atrasadas do evento ativo)
    const overdueCard = screen.getByText("Tarefas atrasadas").parentElement as HTMLElement;
    expect(within(overdueCard).getByText("2")).toBeTruthy();

    // Agenda: tarefa atrasada aparece no grupo próprio e linka para as tarefas do evento
    expect(screen.getByText("Atrasadas")).toBeTruthy();
    const taskLink = screen.getByText("Confirmar som").closest("a");
    expect(taskLink?.getAttribute("href")).toBe("/eventos/e1/tarefas");

    // Portfólio: saúde crítica com motivos legíveis, e seção de encerrados separada
    expect(screen.getByText("Crítico")).toBeTruthy();
    expect(screen.getByText("1 ocorrência crítica aberta")).toBeTruthy();
    expect(screen.getByText("2 tarefas atrasadas")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Encerrados/ })).toBeTruthy();
    // Progresso de tarefas do festival: 1 de 4 concluída
    expect(screen.getByText("25%")).toBeTruthy();
  });
});
