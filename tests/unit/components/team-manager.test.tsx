import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamManager, type TeamRow } from "@/components/admin/TeamManager";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const rows: TeamRow[] = [
  { membershipId: "m-eu", name: "Eu Titular", email: "eu@x.com", role: "OWNER", status: "ACTIVE", isActive: true, mustChangePassword: false, isSelf: true, canModify: false },
  { membershipId: "m-ana", name: "Ana Produtora", email: "ana@x.com", role: "PRODUCER", status: "ACTIVE", isActive: true, mustChangePassword: false, isSelf: false, canModify: true },
  { membershipId: "m-novo", name: "Novo Nome", email: "novo@x.com", role: "STAFF", status: "ACTIVE", isActive: true, mustChangePassword: true, isSelf: false, canModify: true },
  { membershipId: "m-par", name: "Par Admin", email: "par@x.com", role: "ADMIN", status: "ACTIVE", isActive: true, mustChangePassword: false, isSelf: false, canModify: false },
  { membershipId: "m-saiu", name: "Quem Saiu", email: "saiu@x.com", role: "STAFF", status: "REVOKED", isActive: false, mustChangePassword: false, isSelf: false, canModify: true },
];
const assignable = ["PRODUCER", "STAFF", "FREELANCER", "VIEWER"];

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("TeamManager", () => {
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

  it("cada linha mostra só o que quem olha pode fazer: a si mesmo e a par/superior, nada; a quem saiu, reativar", () => {
    render(<TeamManager members={rows} assignableRoles={assignable} />);

    const me = screen.getByText("Eu Titular").closest("li")!;
    expect(within(me).getByText("(você)")).toBeInTheDocument();
    expect(within(me).queryByRole("button")).not.toBeInTheDocument();

    const peer = screen.getByText("Par Admin").closest("li")!;
    expect(within(peer).queryByRole("button")).not.toBeInTheDocument();
    expect(within(peer).queryByRole("combobox")).not.toBeInTheDocument();

    const ana = screen.getByText("Ana Produtora").closest("li")!;
    expect(within(ana).getByLabelText("Papel de Ana Produtora na empresa")).toHaveValue("PRODUCER");
    expect(within(ana).getByRole("button", { name: "Redefinir a senha de Ana Produtora" })).toBeInTheDocument();
    expect(within(ana).getByRole("button", { name: "Encerrar o vínculo de Ana Produtora" })).toBeInTheDocument();

    const gone = screen.getByText("Quem Saiu").closest("li")!;
    expect(within(gone).getByText("Vínculo encerrado")).toBeInTheDocument();
    expect(within(gone).getByRole("button", { name: "Reativar o vínculo de Quem Saiu" })).toBeInTheDocument();
    expect(within(gone).queryByRole("button", { name: /Encerrar/ })).not.toBeInTheDocument();

    expect(screen.getByText("Senha provisória pendente")).toBeInTheDocument();
  });

  it("o seletor de papel do cadastro só oferece os papéis que quem administra pode conceder", () => {
    render(<TeamManager members={rows} assignableRoles={assignable} />);

    const options = within(screen.getByLabelText("Papel na empresa")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Produção", "Equipe", "Freelancer", "Visualização"]);
    expect(options).not.toContain("Titular");
    expect(options).not.toContain("Administração");
  });

  describe("adicionar pessoa", () => {
    it("nome e e-mail inválidos são apontados nos campos, sem ir ao servidor", async () => {
      const user = userEvent.setup();
      render(<TeamManager members={rows} assignableRoles={assignable} />);

      await user.type(screen.getByLabelText("E-mail"), "isso-nao-e-email");
      await user.click(screen.getByRole("button", { name: "Adicionar" }));

      expect(await screen.findByText("Informe o nome da pessoa.")).toBeInTheDocument();
      expect(screen.getByText("Informe um e-mail válido.")).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("conta nova: mostra a senha provisória UMA vez, avisa que não aparece de novo, e some ao confirmar", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(201, { membershipId: "m1", userId: "u1", temporaryPassword: "Xk7m-Pq2w-Hd9r" }));
      render(<TeamManager members={rows} assignableRoles={assignable} />);

      await user.type(screen.getByLabelText("Nome"), "Pessoa Nova");
      await user.type(screen.getByLabelText("E-mail"), "Pessoa.Nova@X.com");
      await user.selectOptions(screen.getByLabelText("Papel na empresa"), "FREELANCER");
      await user.click(screen.getByRole("button", { name: "Adicionar" }));

      const panel = await screen.findByTestId("temp-password-panel");
      expect(within(panel).getByTestId("temp-password")).toHaveTextContent("Xk7m-Pq2w-Hd9r");
      expect(panel).toHaveTextContent("esta senha não aparece de novo");
      expect(panel).toHaveTextContent("pessoa.nova@x.com"); // já normalizado
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/equipe");
      expect(JSON.parse(init.body)).toEqual({ name: "Pessoa Nova", email: "pessoa.nova@x.com", role: "FREELANCER" });
      expect(refresh).toHaveBeenCalled();
      expect(screen.getByLabelText("Nome")).toHaveValue(""); // formulário limpo

      await user.click(screen.getByRole("button", { name: "Já anotei" }));
      expect(screen.queryByTestId("temp-password-panel")).not.toBeInTheDocument();
      expect(screen.queryByText("Xk7m-Pq2w-Hd9r")).not.toBeInTheDocument();
    });

    it("conta que já existia: avisa que a senha dela não muda e NÃO mostra senha provisória", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(201, { membershipId: "m1", userId: "u1", temporaryPassword: null }));
      render(<TeamManager members={rows} assignableRoles={assignable} />);

      await user.type(screen.getByLabelText("Nome"), "Já Tinha");
      await user.type(screen.getByLabelText("E-mail"), "ja@x.com");
      await user.click(screen.getByRole("button", { name: "Adicionar" }));

      expect(await screen.findByRole("status")).toHaveTextContent("a senha dela não muda");
      expect(screen.queryByTestId("temp-password-panel")).not.toBeInTheDocument();
    });

    it("erro do servidor (e-mail já na equipe) aparece como está", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(409, { error: "Esta pessoa já faz parte da equipe." }));
      render(<TeamManager members={rows} assignableRoles={assignable} />);

      await user.type(screen.getByLabelText("Nome"), "Repetida");
      await user.type(screen.getByLabelText("E-mail"), "ana@x.com");
      await user.click(screen.getByRole("button", { name: "Adicionar" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Esta pessoa já faz parte da equipe.");
      expect(refresh).not.toHaveBeenCalled();
    });

    it("copiar leva a senha para a área de transferência", async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      fetchMock.mockReturnValue(respond(201, { membershipId: "m1", userId: "u1", temporaryPassword: "Xk7m-Pq2w-Hd9r" }));
      render(<TeamManager members={rows} assignableRoles={assignable} />);
      await user.type(screen.getByLabelText("Nome"), "Pessoa Nova");
      await user.type(screen.getByLabelText("E-mail"), "p@x.com");
      await user.click(screen.getByRole("button", { name: "Adicionar" }));

      await user.click(await screen.findByRole("button", { name: "Copiar" }));

      expect(writeText).toHaveBeenCalledWith("Xk7m-Pq2w-Hd9r");
      expect(await screen.findByRole("button", { name: "Copiado" })).toBeInTheDocument();
    });
  });

  describe("ações por pessoa", () => {
    it("mudar o papel manda PATCH com o papel escolhido", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(200, { membership: {} }));
      render(<TeamManager members={rows} assignableRoles={assignable} />);

      await user.selectOptions(screen.getByLabelText("Papel de Ana Produtora na empresa"), "VIEWER");

      await waitFor(() => expect(refresh).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/equipe/m-ana");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body)).toEqual({ role: "VIEWER" });
    });

    it("encerrar o vínculo pede confirmação que explica a perda dos acessos; cancelar não envia nada", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(200, { membership: {} }));
      render(<TeamManager members={rows} assignableRoles={assignable} />);

      await user.click(screen.getByRole("button", { name: "Encerrar o vínculo de Ana Produtora" }));
      expect(screen.getByText(/perde o acesso a todos os eventos/)).toBeInTheDocument();
      // A administração precisa saber o que acontece com o aparelho: sai o que o servidor guarda, fica o não enviado.
      expect(screen.getByText(/tiram de si os dados da empresa assim que se conectarem/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Cancelar" }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.queryByText(/perde o acesso a todos os eventos/)).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Encerrar o vínculo de Ana Produtora" }));
      await user.click(screen.getByRole("button", { name: "Confirmar" }));

      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ status: "REVOKED" });
    });

    it("redefinir a senha confirma, avisa que a pessoa sai dos aparelhos (mas o que já baixou fica) e mostra a nova senha provisória uma vez", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(200, { temporaryPassword: "Nn3p-Rr8t-Zz5b" }));
      render(<TeamManager members={rows} assignableRoles={assignable} />);

      await user.click(screen.getByRole("button", { name: "Redefinir a senha de Ana Produtora" }));
      // O aviso antigo ("sessões já abertas continuam") era verdade até a derrubada de sessões existir: não pode voltar.
      expect(screen.queryByText(/Sessões já abertas continuam/)).not.toBeInTheDocument();
      expect(screen.getByText(/sai de todos os aparelhos em que estiver conectada/)).toBeInTheDocument();
      expect(screen.getByText(/dados já\s+baixados num aparelho perdido continuam lá/)).toBeInTheDocument();
      // ...e diz o que resolve, em vez de deixar a administração achar que redefinir a senha basta.
      expect(screen.getByText(/encerre o vínculo/)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Confirmar" }));

      const panel = await screen.findByTestId("temp-password-panel");
      expect(panel).toHaveTextContent("Nova senha provisória de");
      expect(within(panel).getByTestId("temp-password")).toHaveTextContent("Nn3p-Rr8t-Zz5b");
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe("/api/equipe/m-ana/senha");
      expect(init.method).toBe("POST");
    });

    it("desativar a conta pede confirmação e envia o toggle do estado da conta", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(200, { membership: {} }));
      render(<TeamManager members={rows} assignableRoles={assignable} />);

      await user.click(screen.getByRole("button", { name: "Desativar a conta de Ana Produtora" }));
      expect(screen.getByText(/Desativar a conta de/i)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Confirmar" }));

      await waitFor(() => expect(refresh).toHaveBeenCalled());
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ isActive: false });
    });

    it("reativar avisa que os acessos a eventos não voltam sozinhos", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(respond(200, { membership: {} }));
      render(<TeamManager members={rows} assignableRoles={assignable} />);

      await user.click(screen.getByRole("button", { name: "Reativar o vínculo de Quem Saiu" }));

      expect(await screen.findByRole("status")).toHaveTextContent("Os acessos a eventos não voltam sozinhos");
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ status: "ACTIVE" });
    });

    it("recusa do servidor (ex.: único gestor de um evento) é mostrada e não atualiza a página", async () => {
      const user = userEvent.setup();
      fetchMock.mockReturnValue(
        respond(409, { error: "Esta pessoa é a única gestora de: Festival do Parque. Nomeie outro gestor antes de encerrar o vínculo." })
      );
      render(<TeamManager members={rows} assignableRoles={assignable} />);

      await user.click(screen.getByRole("button", { name: "Encerrar o vínculo de Ana Produtora" }));
      await user.click(screen.getByRole("button", { name: "Confirmar" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Festival do Parque");
      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
