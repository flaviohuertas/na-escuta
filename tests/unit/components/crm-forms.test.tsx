import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_MESSAGE } from "@/components/admin/api";
import { ClientForm } from "@/components/crm/ClientForm";
import { ConvertToEventForm } from "@/components/crm/ConvertToEventForm";
import { OpportunityForm } from "@/components/crm/OpportunityForm";
import { navigateToDocument } from "@/lib/offline/navigate";

vi.mock("@/lib/offline/navigate", () => ({ navigateToDocument: vi.fn() }));

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

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

describe("ClientForm", () => {
  const submit = (user: ReturnType<typeof userEvent.setup>, label = "Cadastrar cliente") => user.click(screen.getByRole("button", { name: label }));

  it("cadastra: o que ficou em branco vai como null, e leva para a tela do cliente", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { client: { id: "c-1" } }));
    render(<ClientForm mode="create" />);

    await user.type(screen.getByLabelText("Nome"), "Buffet Sabor");
    await user.type(screen.getByLabelText(/CPF ou CNPJ/), "11.222.333/0001-81");
    await submit(user);

    await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith("/comercial/clientes/c-1"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/comercial/clientes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "Buffet Sabor", kind: "COMPANY", document: "11.222.333/0001-81", email: null, phone: null, notes: null });
  });

  it("valida antes de ir à rede: nome curto, documento com dígito errado e e-mail inválido aparecem NO campo", async () => {
    const user = userEvent.setup();
    render(<ClientForm mode="create" />);

    await user.type(screen.getByLabelText("Nome"), "A");
    await user.type(screen.getByLabelText(/CPF ou CNPJ/), "529.982.247-26");
    await user.type(screen.getByLabelText(/E-mail/), "isso-nao-e-email");
    await submit(user);

    expect(await screen.findByText("Informe o nome do cliente.")).toBeInTheDocument();
    expect(screen.getByText("CPF ou CNPJ inválido.")).toBeInTheDocument();
    expect(screen.getByText("Informe um e-mail válido.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("documento duplicado (409): mostra a mensagem do servidor e continua na tela com o que foi digitado", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "O documento 11.222.333/0001-81 já está cadastrado para Produtora Alfa." }));
    render(<ClientForm mode="create" />);

    await user.type(screen.getByLabelText("Nome"), "Alfa de novo");
    await user.type(screen.getByLabelText(/CPF ou CNPJ/), "11222333000181");
    await submit(user);

    expect(await screen.findByText(/já está cadastrado para Produtora Alfa/)).toBeInTheDocument();
    expect(navigateToDocument).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Carregar os dados atuais" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Nome")).toHaveValue("Alfa de novo");
  });

  it("sem conexão, diz que exige internet e mantém o que foi digitado", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ClientForm mode="create" />);

    await user.type(screen.getByLabelText("Nome"), "Buffet Sabor");
    await submit(user);

    expect(await screen.findByText(OFFLINE_MESSAGE)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nome")).toHaveValue("Buffet Sabor");
  });

  describe("editar", () => {
    const initial = { id: "c-9", name: "Produtora Alfa", kind: "COMPANY" as const, document: "11222333000181", email: "a@alfa.com", phone: null, notes: null, version: 4 };

    it("abre com os dados atuais (documento com máscara) e envia a versão que viu, por PATCH", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(200, { client: { id: "c-9" } }));
      render(<ClientForm mode="edit" initial={initial} />);

      expect(screen.getByLabelText("Nome")).toHaveValue("Produtora Alfa");
      expect(screen.getByLabelText(/CPF ou CNPJ/)).toHaveValue("11.222.333/0001-81");
      await user.type(screen.getByLabelText(/Telefone/), "(31) 3000-0000");
      await submit(user, "Salvar alterações");

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/comercial/clientes/c-9");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body)).toMatchObject({ phone: "(31) 3000-0000", baseVersion: 4 });
    });

    it("se outra pessoa editou antes (409), oferece carregar os dados atuais em vez de sobrescrever", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(409, { error: "Este cliente foi alterado por outra pessoa enquanto você editava." }));
      render(<ClientForm mode="edit" initial={initial} />);

      await submit(user, "Salvar alterações");

      expect(await screen.findByText(/alterado por outra pessoa/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Carregar os dados atuais" })).toBeInTheDocument();
      expect(navigateToDocument).not.toHaveBeenCalled();
    });
  });
});

const C1 = "01991b1a-0000-7000-8000-0000000000c1";
const C2 = "01991b1a-0000-7000-8000-0000000000c2";
const U1 = "01991b1a-0000-7000-8000-0000000000a1";
const U2 = "01991b1a-0000-7000-8000-0000000000a2";

describe("OpportunityForm", () => {
  const clients = [{ id: C1, name: "Produtora Alfa" }, { id: C2, name: "Buffet Sabor" }];
  const owners = [{ id: U1, name: "Bia" }, { id: U2, name: "Caio" }];
  const props = { clients, owners, currentUserId: U1 };
  const submit = (user: ReturnType<typeof userEvent.setup>, label = "Abrir oportunidade") => user.click(screen.getByRole("button", { name: label }));

  it("abre a oportunidade: o valor digitado em reais vai em CENTAVOS, as datas em ISO, e o responsável é quem está logado", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { opportunity: { id: "o-1" } }));
    render(<OpportunityForm mode="create" {...props} />);

    await user.selectOptions(screen.getByLabelText("Cliente"), C2);
    await user.type(screen.getByLabelText("Título"), "Casamento Silva");
    await user.type(screen.getByLabelText(/Valor estimado/), "15.000,00");
    fireEvent.change(screen.getByLabelText(/Início previsto/), { target: { value: "2027-03-01" } });
    fireEvent.change(screen.getByLabelText(/Término previsto/), { target: { value: "2027-03-02" } });
    await submit(user);

    await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith("/comercial/oportunidades/o-1"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/comercial/oportunidades");
    expect(JSON.parse(init.body)).toEqual({
      clientId: C2,
      title: "Casamento Silva",
      description: null,
      expectedValueCents: 1_500_000,
      expectedStartDate: new Date("2027-03-01T00:00").toISOString(),
      expectedEndDate: new Date("2027-03-02T00:00").toISOString(),
      ownerUserId: U1,
    });
  });

  it("vem com o cliente já escolhido quando se chega a partir da tela dele", () => {
    render(<OpportunityForm mode="create" {...props} defaultClientId={C2} />);
    expect(screen.getByLabelText("Cliente")).toHaveValue(C2);
  });

  it("valor que não é dinheiro em pt-BR é recusado no campo (na dúvida, não adivinha)", async () => {
    const user = userEvent.setup();
    render(<OpportunityForm mode="create" {...props} defaultClientId={C1} />);

    await user.type(screen.getByLabelText("Título"), "Festa");
    await user.type(screen.getByLabelText(/Valor estimado/), "1.5");
    await submit(user);

    expect(await screen.findByText(/Informe o valor como 15.000,00/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cliente e título são obrigatórios; término antes do início é recusado", async () => {
    const user = userEvent.setup();
    render(<OpportunityForm mode="create" {...props} />);

    await submit(user);
    expect(await screen.findByText("Informe o título da oportunidade.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Cliente"), C1);
    await user.type(screen.getByLabelText("Título"), "Festa");
    fireEvent.change(screen.getByLabelText(/Início previsto/), { target: { value: "2027-03-05" } });
    fireEvent.change(screen.getByLabelText(/Término previsto/), { target: { value: "2027-03-01" } });
    await submit(user);
    expect(await screen.findByText("A data de término não pode ser anterior à data de início")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem valor e sem datas, esses campos vão como null", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { opportunity: { id: "o-2" } }));
    render(<OpportunityForm mode="create" {...props} defaultClientId={C1} />);

    await user.type(screen.getByLabelText("Título"), "Festa");
    await submit(user);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ expectedValueCents: null, expectedStartDate: null, expectedEndDate: null });
  });

  describe("editar", () => {
    const initial = {
      id: "o-9",
      clientId: C1,
      title: "Festival",
      description: "Três dias",
      expectedValueCents: 1_500_000,
      expectedStartDate: new Date("2027-03-01T00:00").toISOString(),
      expectedEndDate: null,
      ownerUserId: U2,
      version: 3,
    };

    it("abre com os dados atuais (valor com milhar e vírgula), NÃO deixa trocar o cliente e envia a versão que viu", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(200, { opportunity: { id: "o-9" } }));
      render(<OpportunityForm mode="edit" {...props} initial={initial} />);

      expect(screen.getByLabelText("Cliente")).toBeDisabled();
      expect(screen.getByLabelText("Cliente")).toHaveValue(C1);
      expect(screen.getByLabelText(/Valor estimado/)).toHaveValue("15.000,00");
      expect(screen.getByLabelText(/Início previsto/)).toHaveValue("2027-03-01");
      expect(screen.getByLabelText("Responsável")).toHaveValue(U2);
      await user.clear(screen.getByLabelText("Título"));
      await user.type(screen.getByLabelText("Título"), "Festival 2027");
      await submit(user, "Salvar alterações");

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/comercial/oportunidades/o-9");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body)).toMatchObject({ clientId: C1, title: "Festival 2027", expectedValueCents: 1_500_000, baseVersion: 3, ownerUserId: U2 });
    });

    it("409: oferece carregar os dados atuais", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(409, { error: "Esta oportunidade foi alterada por outra pessoa." }));
      render(<OpportunityForm mode="edit" {...props} initial={initial} />);

      await submit(user, "Salvar alterações");

      expect(await screen.findByRole("button", { name: "Carregar os dados atuais" })).toBeInTheDocument();
    });
  });
});

describe("ConvertToEventForm", () => {
  const initial = { name: "Festival de Verão", description: "Três dias de música", startDate: new Date("2027-01-10T09:00").toISOString(), endDate: null };
  const submit = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: "Criar evento e marcar como ganha" }));

  it("vem preenchido com os dados da oportunidade (nome, descrição e o início previsto)", () => {
    render(<ConvertToEventForm opportunityId="o-1" version={2} initial={initial} />);

    expect(screen.getByLabelText("Nome do evento")).toHaveValue("Festival de Verão");
    expect(screen.getByLabelText("Descrição (opcional)")).toHaveValue("Três dias de música");
    expect(screen.getByLabelText("Início do evento")).toHaveValue("2027-01-10T09:00");
    expect(screen.getByLabelText("Término do evento")).toHaveValue("");
    expect(screen.getByLabelText("Situação")).toHaveValue("PLANNED");
  });

  it("sem o término não envia: pede a data (a oportunidade pode não ter datas previstas)", async () => {
    const user = userEvent.setup();
    render(<ConvertToEventForm opportunityId="o-1" version={2} initial={initial} />);

    await submit(user);

    expect(await screen.findByText("Informe a data de término")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirma: envia o evento e a versão da oportunidade e leva para o evento criado", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(201, { event: { id: "e-1" } }));
    render(<ConvertToEventForm opportunityId="o-1" version={2} initial={initial} />);

    fireEvent.change(screen.getByLabelText("Término do evento"), { target: { value: "2027-01-12T22:00" } });
    await user.type(screen.getByLabelText(/Local/), "Parque Central");
    await submit(user);

    await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith("/eventos/e-1"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/comercial/oportunidades/o-1/evento");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      event: {
        name: "Festival de Verão",
        description: "Três dias de música",
        location: "Parque Central",
        startDate: new Date("2027-01-10T09:00").toISOString(),
        endDate: new Date("2027-01-12T22:00").toISOString(),
        status: "PLANNED",
      },
      baseVersion: 2,
    });
  });

  it("término antes do início é recusado no campo", async () => {
    const user = userEvent.setup();
    render(<ConvertToEventForm opportunityId="o-1" version={2} initial={initial} />);

    fireEvent.change(screen.getByLabelText("Término do evento"), { target: { value: "2027-01-01T10:00" } });
    await submit(user);

    expect(await screen.findByText("A data de término não pode ser anterior à data de início")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("se a oportunidade já mudou ou virou evento (409): mostra a mensagem do servidor, oferece recarregar e NÃO navega", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(409, { error: "Esta oportunidade já virou um evento." }));
    render(<ConvertToEventForm opportunityId="o-1" version={2} initial={{ ...initial, endDate: new Date("2027-01-12T22:00").toISOString() }} />);

    await submit(user);

    expect(await screen.findByText("Esta oportunidade já virou um evento.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Carregar os dados atuais" })).toBeInTheDocument();
    expect(navigateToDocument).not.toHaveBeenCalled();
  });
});
