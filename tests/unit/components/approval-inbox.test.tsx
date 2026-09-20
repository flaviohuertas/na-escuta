import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalInbox } from "@/components/approvals/ApprovalInbox";
import { MyProposals } from "@/components/approvals/MyProposals";
import type { ProposalView } from "@/lib/domain/approval";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

function proposal(overrides: Partial<ProposalView> = {}): ProposalView {
  return {
    id: "p-1",
    eventId: "e-1",
    eventName: "Festival do Parque",
    submittedBy: { id: "u-1", name: "Bia Campo" },
    submittedAt: "2026-09-20T15:00:00.000Z",
    status: "PENDING",
    reason: "O nome oficial mudou",
    changes: [
      { field: "name", label: "Nome", before: "Festival do Parque", current: "Festival do Parque", proposed: "Festival do Parque 2026", conflict: false },
      { field: "startDate", label: "Início", before: "2026-12-01T12:00:00.000Z", current: "2026-12-01T12:00:00.000Z", proposed: "2026-12-01T13:00:00.000Z", conflict: false },
    ],
    conflictFields: [],
    unreadable: false,
    reviewedByName: null,
    reviewedAt: null,
    reviewNotes: null,
    ...overrides,
  };
}

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("ApprovalInbox", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
    refresh.mockClear();
    vi.unstubAllGlobals();
  });

  it("mostra a proposta: quem propôs, o motivo e cada campo com o antes e o proposto (datas no horário de Brasília)", () => {
    render(<ApprovalInbox pending={[proposal()]} decided={[]} />);

    const card = screen.getByTestId("pending-proposal");
    expect(within(card).getByRole("link", { name: "Festival do Parque" })).toHaveAttribute("href", "/eventos/e-1");
    expect(within(card).getByText("Bia Campo")).toBeInTheDocument();
    expect(within(card).getByText(/Motivo: O nome oficial mudou/)).toBeInTheDocument();
    const name = card.querySelector('[data-field="name"]')!;
    expect(name).toHaveTextContent("Nome");
    expect(name).toHaveTextContent("Festival do Parque");
    expect(name).toHaveTextContent("Festival do Parque 2026");
    expect(card.querySelector('[data-field="startDate"]')).toHaveTextContent(/09:00.*10:00/s);
    expect(screen.getByRole("button", { name: "Aprovar a proposta de Bia Campo para Festival do Parque" })).toBeEnabled();
  });

  it("sem propostas, diz isso", () => {
    render(<ApprovalInbox pending={[]} decided={[]} />);
    expect(screen.getByText("Nenhuma proposta esperando decisão.")).toBeInTheDocument();
  });

  describe("aprovar", () => {
    it("envia a decisão, avisa que foi aplicada e atualiza a lista", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(200, { approval: proposal({ status: "APPROVED" }) }));
      render(<ApprovalInbox pending={[proposal()]} decided={[]} />);

      await user.type(screen.getByLabelText(/Observação/), "Confere com o contrato");
      await user.click(screen.getByRole("button", { name: /Aprovar a proposta/ }));

      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(screen.getByRole("status")).toHaveTextContent(/aprovada e aplicada ao evento/);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/aprovacoes/p-1/decisao");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ decision: "APPROVE", notes: "Confere com o contrato" });
    });

    it("aprovar sem observação é permitido", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(200, { approval: proposal({ status: "APPROVED" }) }));
      render(<ApprovalInbox pending={[proposal()]} decided={[]} />);

      await user.click(screen.getByRole("button", { name: /Aprovar a proposta/ }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ decision: "APPROVE" });
    });

    it("se o servidor recusar, a mensagem dele aparece NO CARTÃO e a lista não é atualizada", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(409, { error: "O evento foi alterado depois da proposta (Nome)." }));
      render(<ApprovalInbox pending={[proposal()]} decided={[]} />);

      await user.click(screen.getByRole("button", { name: /Aprovar a proposta/ }));

      expect(await screen.findByTestId("proposal-error")).toHaveTextContent("O evento foi alterado depois da proposta (Nome).");
      expect(refresh).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("sem conexão, diz que exige internet (e não fica pendurada)", async () => {
      const user = userEvent.setup();
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      render(<ApprovalInbox pending={[proposal()]} decided={[]} />);

      await user.click(screen.getByRole("button", { name: /Aprovar a proposta/ }));

      expect(await screen.findByTestId("proposal-error")).toHaveTextContent(/Sem conexão/);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("rejeitar", () => {
    it("SEM motivo não envia nada: mostra o que falta", async () => {
      const user = userEvent.setup();
      render(<ApprovalInbox pending={[proposal()]} decided={[]} />);

      await user.click(screen.getByRole("button", { name: /Rejeitar a proposta/ }));

      expect(await screen.findByTestId("proposal-error")).toHaveTextContent("Explique o motivo da rejeição para quem propôs.");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("com o motivo, envia e avisa que quem propôs verá o que foi dito", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(200, { approval: proposal({ status: "REJECTED" }) }));
      render(<ApprovalInbox pending={[proposal()]} decided={[]} />);

      await user.type(screen.getByLabelText(/Observação/), "O nome só muda depois da assembleia");
      await user.click(screen.getByRole("button", { name: /Rejeitar a proposta/ }));

      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ decision: "REJECT", notes: "O nome só muda depois da assembleia" });
      expect(screen.getByRole("status")).toHaveTextContent(/Proposta rejeitada/);
    });
  });

  it("uma observação por proposta: escrever numa não vaza para a outra", async () => {
    const user = userEvent.setup();
    render(<ApprovalInbox pending={[proposal({ id: "p-1" }), proposal({ id: "p-2", submittedBy: { id: "u-2", name: "Caio Campo" } })]} decided={[]} />);

    const [first, second] = screen.getAllByLabelText(/Observação/);
    await user.type(first!, "só na primeira");

    expect(first).toHaveValue("só na primeira");
    expect(second).toHaveValue("");
  });

  describe("proposta que o evento deixou para trás", () => {
    const stale = () =>
      proposal({
        conflictFields: ["name"],
        changes: [{ field: "name", label: "Nome", before: "Festival do Parque", current: "Editado pelo gestor", proposed: "Proposto", conflict: true }],
      });

    it("bloqueia APROVAR, diz qual campo mudou e para quê o valor de agora — e oferece editar o evento direto", () => {
      render(<ApprovalInbox pending={[stale()]} decided={[]} />);

      expect(screen.getByRole("button", { name: /Aprovar a proposta/ })).toBeDisabled();
      const warning = screen.getByRole("alert");
      expect(warning).toHaveTextContent(/O evento mudou depois desta proposta \(Nome\)/);
      expect(within(warning).getByRole("link", { name: "edite o evento direto" })).toHaveAttribute("href", "/eventos/e-1/editar");
      expect(screen.getByTestId("pending-proposal")).toHaveTextContent(/Mudou depois da proposta: agora está como Editado pelo gestor/);
    });

    it("mas REJEITAR continua possível", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(200, { approval: proposal({ status: "REJECTED" }) }));
      render(<ApprovalInbox pending={[stale()]} decided={[]} />);

      await user.type(screen.getByLabelText(/Observação/), "O gestor já mudou o nome");
      await user.click(screen.getByRole("button", { name: /Rejeitar a proposta/ }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    });
  });

  it("proposta ilegível (JSON corrompido): não mostra campos, não deixa aprovar, deixa rejeitar", () => {
    render(<ApprovalInbox pending={[proposal({ unreadable: true, changes: [] })]} decided={[]} />);

    expect(screen.getByText(/corrompida e não pode ser aplicada/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Aprovar a proposta/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Rejeitar a proposta/ })).toBeEnabled();
  });

  it("lista as decididas recentemente com quem decidiu e a observação", () => {
    render(
      <ApprovalInbox
        pending={[]}
        decided={[proposal({ id: "d-1", status: "REJECTED", reviewedByName: "Gil Gestor", reviewedAt: "2026-09-20T16:00:00.000Z", reviewNotes: "Não é o nome oficial" })]}
      />
    );

    const row = screen.getByTestId("decided-proposal");
    expect(row).toHaveTextContent("Rejeitada");
    expect(row).toHaveTextContent(/rejeitada por Gil Gestor/);
    expect(row).toHaveTextContent("Não é o nome oficial");
  });
});

describe("MyProposals", () => {
  afterEach(() => cleanup());

  it("sem propostas, diz isso", () => {
    render(<MyProposals proposals={[]} />);
    expect(screen.getByText("Você ainda não propôs nenhuma alteração.")).toBeInTheDocument();
  });

  it("pendente: só a situação; rejeitada: quem rejeitou e o MOTIVO; aprovada: a observação", () => {
    render(
      <MyProposals
        proposals={[
          proposal({ id: "a" }),
          proposal({ id: "b", status: "REJECTED", reviewedByName: "Gil Gestor", reviewedAt: "2026-09-20T16:00:00.000Z", reviewNotes: "O nome só muda depois da assembleia" }),
          proposal({ id: "c", status: "APPROVED", reviewedByName: "Gil Gestor", reviewedAt: "2026-09-20T16:00:00.000Z", reviewNotes: "Confere" }),
        ]}
      />
    );

    const [pending, rejected, approved] = screen.getAllByTestId("my-proposal");
    expect(pending).toHaveTextContent("Aguardando decisão");
    expect(pending).not.toHaveTextContent(/Rejeitada|Aprovada/);
    expect(rejected).toHaveTextContent(/Rejeitada por Gil Gestor.*Motivo: O nome só muda depois da assembleia/s);
    expect(approved).toHaveTextContent(/Aprovada por Gil Gestor.*Observação: Confere/s);
  });

  it("não destaca conflito (a pessoa que propôs não decide)", () => {
    render(<MyProposals proposals={[proposal({ changes: [{ field: "name", label: "Nome", before: "A", current: "C", proposed: "B", conflict: true }] })]} />);
    expect(screen.queryByText(/Mudou depois da proposta/)).not.toBeInTheDocument();
  });
});
