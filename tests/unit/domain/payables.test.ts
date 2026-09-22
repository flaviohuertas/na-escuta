import { describe, expect, it } from "vitest";
import { classifyPayable, describePayableStatus, payableStatusLabel } from "@/lib/domain/payables";

describe("payables — primeiro passo do módulo financeiro", () => {
  it("marca como pago, vencido ou em aberto conforme o status real", () => {
    expect(classifyPayable({ dueDate: "2027-01-10", paidAt: "2027-01-09", cancelledAt: null, today: "2027-01-10" })).toBe("PAID");
    expect(classifyPayable({ dueDate: "2027-01-10", paidAt: null, cancelledAt: null, today: "2027-01-11" })).toBe("OVERDUE");
    expect(classifyPayable({ dueDate: "2027-01-10", paidAt: null, cancelledAt: null, today: "2027-01-09" })).toBe("OPEN");
    expect(classifyPayable({ dueDate: "2027-01-10", paidAt: null, cancelledAt: "2027-01-08", today: "2027-01-11" })).toBe("CANCELLED");
  });

  it("a etiqueta lida em português e a descrição explica o motivo do estado", () => {
    expect(payableStatusLabel("OVERDUE")).toBe("Vencida");
    expect(describePayableStatus({ dueDate: "2027-01-10", paidAt: null, cancelledAt: null, today: "2027-01-11" })).toBe("Vencida em 10/01/2027.");
    expect(describePayableStatus({ dueDate: "2027-01-10", paidAt: "2027-01-09", cancelledAt: null, today: "2027-01-10" })).toBe("Paga.");
    expect(describePayableStatus({ dueDate: "2027-01-10", paidAt: null, cancelledAt: "2027-01-08", today: "2027-01-11" })).toBe("Cancelada.");
  });
});
