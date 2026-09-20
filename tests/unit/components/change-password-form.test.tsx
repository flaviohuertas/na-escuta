import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_MESSAGE } from "@/components/admin/api";
import { ChangePasswordForm } from "@/components/account/ChangePasswordForm";
import { navigateToDocument } from "@/lib/offline/navigate";

vi.mock("@/lib/offline/navigate", () => ({ navigateToDocument: vi.fn() }));

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("ChangePasswordForm", () => {
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

  async function fill(user: ReturnType<typeof userEvent.setup>, current: string, next: string, confirm = next) {
    await user.type(screen.getByLabelText(/Senha (atual|provisória)/), current);
    await user.type(screen.getByLabelText("Nova senha"), next);
    await user.type(screen.getByLabelText("Repita a nova senha"), confirm);
    await user.click(screen.getByRole("button", { name: "Salvar nova senha" }));
  }

  it("com senha provisória, explica e trata o primeiro campo como a senha provisória (sem 'Cancelar': não há para onde voltar)", () => {
    render(<ChangePasswordForm forced />);

    expect(screen.getByText(/entrou com uma senha provisória/)).toBeInTheDocument();
    expect(screen.getByLabelText("Senha provisória")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Cancelar" })).not.toBeInTheDocument();
  });

  it("troca voluntária: pede a senha atual e oferece cancelar", () => {
    render(<ChangePasswordForm forced={false} />);

    expect(screen.getByLabelText("Senha atual")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cancelar" })).toHaveAttribute("href", "/eventos");
  });

  it("envia só a senha atual e a nova (a confirmação é só conferência local) e segue para o app", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(200, { ok: true }));
    render(<ChangePasswordForm forced />);

    await fill(user, "Xk7m-Pq2w-Hd9r", "uma-senha-nova-bem-longa");

    await waitFor(() => expect(navigateToDocument).toHaveBeenCalledWith("/eventos"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/conta/senha");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ currentPassword: "Xk7m-Pq2w-Hd9r", newPassword: "uma-senha-nova-bem-longa" });
  });

  it("nova senha curta, diferente da confirmação ou igual à atual: aponta no campo e NÃO envia", async () => {
    const user = userEvent.setup();
    render(<ChangePasswordForm forced={false} />);

    await fill(user, "senha-atual-longa", "curta");
    expect(await screen.findByText(/pelo menos 10 caracteres/)).toBeInTheDocument();

    cleanup();
    render(<ChangePasswordForm forced={false} />);
    await fill(user, "senha-atual-longa", "uma-senha-nova-bem-longa", "outra-coisa-bem-longa");
    expect(await screen.findByText("As senhas não conferem.")).toBeInTheDocument();

    cleanup();
    render(<ChangePasswordForm forced={false} />);
    await fill(user, "mesma-senha-longa", "mesma-senha-longa");
    expect(await screen.findByText("A nova senha precisa ser diferente da atual.")).toBeInTheDocument();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigateToDocument).not.toHaveBeenCalled();
  });

  it("senha atual errada (422): mostra o erro do servidor e fica na tela", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(respond(422, { error: "A senha atual não confere." }));
    render(<ChangePasswordForm forced />);

    await fill(user, "errada-errada", "uma-senha-nova-bem-longa");

    expect(await screen.findByText("A senha atual não confere.")).toBeInTheDocument();
    expect(navigateToDocument).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Salvar nova senha" })).toBeEnabled();
  });

  it("sem conexão, diz que exige internet e não envia", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ChangePasswordForm forced />);

    await fill(user, "Xk7m-Pq2w-Hd9r", "uma-senha-nova-bem-longa");

    expect(await screen.findByText(OFFLINE_MESSAGE)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
