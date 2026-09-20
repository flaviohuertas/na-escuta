import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EventAccessManager,
  type AccessCandidate,
  type AccessRow,
} from "@/components/admin/EventAccessManager";
import { callApi, OFFLINE_MESSAGE } from "@/components/admin/api";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const eventId = "01991b1a-0000-7000-8000-000000000010";
const ana = "11111111-1111-4111-8111-111111111111";
const bruno = "22222222-2222-4222-8222-222222222222";
const carla = "33333333-3333-4333-8333-333333333333";

const rows: AccessRow[] = [
  { userId: ana, name: "Ana Gestora", email: "ana@x.com", role: "MANAGER", status: "ACTIVE", membershipActive: true },
  { userId: bruno, name: "Bruno Campo", email: "bruno@x.com", role: "FIELD_STAFF", status: "ACTIVE", membershipActive: true },
  { userId: carla, name: "Carla Antiga", email: "carla@x.com", role: "VIEWER", status: "REVOKED", membershipActive: true },
];
const candidates: AccessCandidate[] = [
  { userId: "44444444-4444-4444-8444-444444444444", name: "Diego Novo", email: "diego@x.com", companyRole: "STAFF" },
];

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("EventAccessManager", () => {
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

  it("lista quem tem acesso e quem já teve, cada um com a ação que faz sentido", () => {
    render(<EventAccessManager eventId={eventId} rows={rows} candidates={candidates} />);

    const list = screen.getByRole("list");
    expect(within(list).getByText("Ana Gestora")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retirar o acesso de Ana Gestora" })).toBeInTheDocument();
    expect(screen.getByLabelText("Papel de Bruno Campo no evento")).toHaveValue("FIELD_STAFF");
    // Quem teve o acesso retirado: sem seletor de papel, com "Reativar".
    expect(screen.getByText("Acesso retirado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reativar o acesso de Carla Antiga" })).toBeEnabled();
    expect(screen.queryByLabelText("Papel de Carla Antiga no evento")).not.toBeInTheDocument();
  });

  it("dá acesso: envia pessoa e papel, avisa e atualiza a página", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { access: {} }));
    render(<EventAccessManager eventId={eventId} rows={rows} candidates={candidates} />);

    expect(screen.getByRole("button", { name: "Dar acesso" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Pessoa"), candidates[0]!.userId);
    await user.selectOptions(screen.getByLabelText("Papel no evento"), "VIEWER");
    await user.click(screen.getByRole("button", { name: "Dar acesso" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/eventos/${eventId}/acessos`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ userId: candidates[0]!.userId, role: "VIEWER" });
    expect(await screen.findByRole("status")).toHaveTextContent("Acesso concedido.");
  });

  it("retirar o acesso manda PATCH com a situação REVOKED", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { access: {} }));
    render(<EventAccessManager eventId={eventId} rows={rows} candidates={candidates} />);

    await user.click(screen.getByRole("button", { name: "Retirar o acesso de Bruno Campo" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/eventos/${eventId}/acessos/${bruno}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ status: "REVOKED" });
  });

  it("mudar o papel e reativar mandam o campo certo", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { access: {} }));
    render(<EventAccessManager eventId={eventId} rows={rows} candidates={candidates} />);

    await user.selectOptions(screen.getByLabelText("Papel de Bruno Campo no evento"), "MANAGER");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ role: "MANAGER" });

    await user.click(screen.getByRole("button", { name: "Reativar o acesso de Carla Antiga" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/eventos/${eventId}/acessos/${carla}`);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ status: "ACTIVE" });
  });

  it("mostra a mensagem do servidor quando a regra recusa (ex.: último gestor) e NÃO atualiza a página", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(
      respond(409, { error: "O evento precisa de pelo menos um gestor com acesso ativo." })
    );
    render(<EventAccessManager eventId={eventId} rows={rows} candidates={candidates} />);

    await user.click(screen.getByRole("button", { name: "Retirar o acesso de Ana Gestora" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("pelo menos um gestor");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sem conexão, diz que a ação exige internet e nem tenta enviar", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<EventAccessManager eventId={eventId} rows={rows} candidates={candidates} />);

    await user.click(screen.getByRole("button", { name: "Retirar o acesso de Bruno Campo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(OFFLINE_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem candidatos, explica em vez de mostrar um formulário vazio", () => {
    render(<EventAccessManager eventId={eventId} rows={rows} candidates={[]} />);

    expect(screen.getByText(/Todas as pessoas ativas da empresa já têm acesso/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dar acesso" })).not.toBeInTheDocument();
  });

  it("avisa quando o acesso existe mas a pessoa já não tem vínculo com a empresa, e não deixa reativar", () => {
    render(
      <EventAccessManager
        eventId={eventId}
        rows={[{ ...rows[2]!, membershipActive: false }]}
        candidates={[]}
      />
    );

    expect(screen.getByText(/Sem vínculo ativo com a empresa/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reativar o acesso de Carla Antiga" })).toBeDisabled();
  });
});

describe("callApi", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("devolve os dados quando dá certo", async () => {
    fetchMock.mockReturnValue(respond(200, { x: 1 }));
    expect(await callApi("POST", "/api/x", { a: 1 })).toEqual({ ok: true, data: { x: 1 } });
  });

  it("sessão expirada (401) vira uma frase, sem lançar", async () => {
    fetchMock.mockReturnValue(respond(401, { error: "SESSION_EXPIRED" }));
    const result = await callApi("PATCH", "/api/x");
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(result.ok === false && result.message).toMatch(/sessão expirou/);
  });

  it("prefere o erro do campo ao erro geral, e cai no genérico se o corpo não for JSON", async () => {
    fetchMock.mockReturnValueOnce(respond(422, { error: "Confira os campos.", fieldErrors: { email: ["E-mail inválido"] } }));
    const field = await callApi("POST", "/api/x");
    expect(field.ok === false && field.message).toBe("E-mail inválido");

    fetchMock.mockReturnValueOnce(Promise.resolve(new Response("<html>", { status: 500 })));
    const generic = await callApi("POST", "/api/x");
    expect(generic.ok === false && generic.message).toBe("Não foi possível concluir a ação.");
  });

  it("fetch que rejeita e navegador offline dão a mesma orientação", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await callApi("POST", "/api/x")).toMatchObject({ ok: false, message: OFFLINE_MESSAGE, status: null });

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    fetchMock.mockClear();
    expect(await callApi("POST", "/api/x")).toMatchObject({ ok: false, message: OFFLINE_MESSAGE });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
