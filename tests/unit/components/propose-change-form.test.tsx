import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposeChangeForm, type ProposeFormInitial } from "@/components/approvals/ProposeChangeForm";
import { OFFLINE_MESSAGE } from "@/components/admin/api";
import { isoToLocalInput } from "@/lib/domain/datetime-local";
import { navigateToDocument } from "@/lib/offline/navigate";

vi.mock("@/lib/offline/navigate", () => ({ navigateToDocument: vi.fn() }));

const EVENT_ID = "01991b1a-0000-7000-8000-0000000000e1";

const initial: ProposeFormInitial = {
  id: EVENT_ID,
  name: "Festival do Parque",
  description: null,
  location: "Parque",
  startDate: "2026-12-01T12:00:00.000Z",
  endDate: "2026-12-02T12:00:00.000Z",
  status: "PLANNED",
};

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("ProposeChangeForm", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
    vi.mocked(navigateToDocument).mockClear();
    vi.unstubAllGlobals();
  });

  const submit = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Enviar proposta" }));

  it("começa com os valores ATUAIS do evento", () => {
    render(<ProposeChangeForm initial={initial} />);

    expect(screen.getByLabelText("Nome do evento")).toHaveValue("Festival do Parque");
    expect(screen.getByLabelText("Local")).toHaveValue("Parque");
    expect(screen.getByLabelText("Início")).toHaveValue(isoToLocalInput(initial.startDate));
    expect(screen.getByLabelText("Situação")).toHaveValue("PLANNED");
    expect(screen.getByLabelText("Descrição")).toHaveValue("");
  });

  it("sem alterar nada, não envia e pede para alterar um campo", async () => {
    const user = userEvent.setup();
    render(<ProposeChangeForm initial={initial} />);

    await submit(user);

    expect(screen.getByRole("alert")).toHaveTextContent("Altere pelo menos um campo antes de enviar.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("envia SÓ o que mudou (o resto fica de fora), com o motivo", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { approval: {} }));
    render(<ProposeChangeForm initial={initial} />);

    await user.clear(screen.getByLabelText("Nome do evento"));
    await user.type(screen.getByLabelText("Nome do evento"), "Festival do Parque 2026");
    await user.selectOptions(screen.getByLabelText("Situação"), "CONFIRMED");
    await user.type(screen.getByLabelText(/Por que corrigir/), "O nome oficial mudou");
    await submit(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/aprovacoes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      eventId: EVENT_ID,
      changes: { name: "Festival do Parque 2026", status: "CONFIRMED" },
      reason: "O nome oficial mudou",
    });
  });

  it("esvaziar o local vira 'sem valor' (null) na proposta; sem motivo digitado, o motivo vai nulo", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { approval: {} }));
    render(<ProposeChangeForm initial={initial} />);

    await user.clear(screen.getByLabelText("Local"));
    await submit(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ eventId: EVENT_ID, changes: { location: null }, reason: null });
  });

  it("mudar uma data envia a data em ISO; a que não mudou não vai", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { approval: {} }));
    render(<ProposeChangeForm initial={initial} />);

    fireEvent.change(screen.getByLabelText("Término"), { target: { value: "2026-12-05T10:00" } });
    await submit(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(Object.keys(body.changes)).toEqual(["endDate"]);
    expect(new Date(body.changes.endDate).toString()).not.toBe("Invalid Date");
  });

  it("término antes do início: recusa ali mesmo, no campo do término, sem ir ao servidor", async () => {
    const user = userEvent.setup();
    render(<ProposeChangeForm initial={initial} />);

    fireEvent.change(screen.getByLabelText("Término"), { target: { value: "2026-11-20T10:00" } });
    await submit(user);

    expect(await screen.findByText("A data de término não pode ser anterior à data de início")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("nome em branco: mostra o erro no campo e não envia", async () => {
    const user = userEvent.setup();
    render(<ProposeChangeForm initial={initial} />);

    await user.clear(screen.getByLabelText("Nome do evento"));
    await submit(user);

    expect(await screen.findByText("Informe o nome do evento")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("depois de enviada, leva para a lista de aprovações", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { approval: {} }));
    render(<ProposeChangeForm initial={initial} />);

    await user.type(screen.getByLabelText("Local"), " Norte");
    await submit(user);

    await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith("/aprovacoes"));
  });

  it("mostra a mensagem do servidor quando ele recusa (limite de propostas, sem permissão…) e NÃO sai da tela", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "Você já tem 5 propostas esperando decisão neste evento." }));
    render(<ProposeChangeForm initial={initial} />);

    await user.type(screen.getByLabelText("Local"), " Norte");
    await submit(user);

    expect(await screen.findByText(/Você já tem 5 propostas/)).toBeInTheDocument();
    expect(navigateToDocument).not.toHaveBeenCalled();
    // O que a pessoa digitou continua ali.
    expect(screen.getByLabelText("Local")).toHaveValue("Parque Norte");
  });

  it("sem conexão, diz que exige internet e mantém o que foi digitado", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ProposeChangeForm initial={initial} />);

    await user.type(screen.getByLabelText("Local"), " Norte");
    await submit(user);

    expect(await screen.findByText(OFFLINE_MESSAGE)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Local")).toHaveValue("Parque Norte");
  });
});
