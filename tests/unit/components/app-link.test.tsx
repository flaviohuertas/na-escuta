import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppLink } from "@/components/ui/AppLink";
import { connectivityMonitor, type ConnectivityStatus } from "@/lib/sync/connectivity";
import { navigateToDocument } from "@/lib/offline/navigate";

vi.mock("@/lib/offline/navigate", () => ({ navigateToDocument: vi.fn() }));

function setConnectivity(status: ConnectivityStatus) {
  vi.spyOn(connectivityMonitor, "getState").mockReturnValue({
    status,
    lastCheckedAt: null,
    lastSuccessAt: null,
  });
}

describe("AppLink", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(navigateToDocument).mockClear();
  });

  it("sem conexão efetiva, o clique vira navegação de documento (servida pelo Service Worker)", () => {
    setConnectivity("offline");
    render(<AppLink href="/eventos/e1/tarefas">Tarefas</AppLink>);

    const notPrevented = fireEvent.click(screen.getByRole("link", { name: "Tarefas" }));

    expect(navigateToDocument).toHaveBeenCalledWith("/eventos/e1/tarefas");
    // fireEvent devolve false quando o handler chamou preventDefault: o roteador do Next não entra em cena.
    expect(notPrevented).toBe(false);
  });

  it("com conexão, deixa o next/link cuidar da navegação (sem recarregar a página)", () => {
    setConnectivity("online");
    render(<AppLink href="/eventos/e1/tarefas">Tarefas</AppLink>);

    fireEvent.click(screen.getByRole("link", { name: "Tarefas" }));

    expect(navigateToDocument).not.toHaveBeenCalled();
  });

  it.each([
    ["Ctrl+clique", { ctrlKey: true }],
    ["Cmd+clique", { metaKey: true }],
    ["Shift+clique", { shiftKey: true }],
    ["clique do meio", { button: 1 }],
  ])("%s (nova aba/janela) é do navegador, mesmo offline", (_name, init) => {
    setConnectivity("offline");
    render(<AppLink href="/eventos/e1">Evento</AppLink>);

    fireEvent.click(screen.getByRole("link", { name: "Evento" }), init);

    expect(navigateToDocument).not.toHaveBeenCalled();
  });

  it("respeita um onClick que já cancelou o evento", () => {
    setConnectivity("offline");
    render(
      <AppLink href="/eventos/e1" onClick={(e) => e.preventDefault()}>
        Evento
      </AppLink>
    );

    fireEvent.click(screen.getByRole("link", { name: "Evento" }));

    expect(navigateToDocument).not.toHaveBeenCalled();
  });

  it("mantém o href real (abrir em nova aba, copiar link e leitores de tela continuam funcionando)", () => {
    setConnectivity("offline");
    render(<AppLink href="/eventos/e1/checklists">Checklists</AppLink>);

    expect(screen.getByRole("link", { name: "Checklists" })).toHaveAttribute("href", "/eventos/e1/checklists");
  });
});
