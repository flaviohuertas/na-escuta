import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppNav } from "@/components/layout/AppNav";

let pathname = "/eventos";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

// O menu tem duas apresentações no DOM (barra lateral e barra de baixo); no navegador só uma é
// visível, mas o jsdom não aplica o CSS — por isso cada teste diz de qual está falando.
const sidebar = () => within(screen.getByRole("navigation", { name: "Menu principal" }));
const bottomBar = () => within(screen.getByRole("navigation", { name: "Menu principal (barra inferior)" }));
// O painel "Mais" é um <dialog> fechado: para o testing-library tudo dentro dele está oculto e os
// nomes acessíveis saem vazios (aberto, resolvem). Por isso ele é achado pelo título e conferido
// por texto, não por papel.
const moreSheet = () => within(screen.getByText("Menu", { selector: "h2" }).closest("dialog")!);
const hrefOf = (el: HTMLElement) => el.closest("a")?.getAttribute("href");

describe("AppNav", () => {
  afterEach(() => {
    cleanup();
    pathname = "/eventos";
  });

  it("o link 'Equipe' só aparece para quem administra a equipe — em lugar nenhum do menu", () => {
    render(<AppNav userName="Fulana" canManageTeam />);
    expect(sidebar().getByRole("link", { name: "Equipe" })).toHaveAttribute("href", "/administracao/equipe");

    cleanup();
    render(<AppNav userName="Fulana" />);
    expect(screen.queryByRole("link", { name: "Equipe", hidden: true })).not.toBeInTheDocument();
  });

  it("qualquer pessoa alcança 'Aprovações'; o número só aparece quando há propostas esperando a decisão dela", () => {
    render(<AppNav userName="Fulana" />);
    expect(sidebar().getByRole("link", { name: "Aprovações" })).toHaveAttribute("href", "/aprovacoes");
    expect(screen.queryByLabelText(/aguardando sua decisão/)).not.toBeInTheDocument();

    cleanup();
    render(<AppNav userName="Fulana" pendingApprovals={3} />);
    expect(sidebar().getByLabelText("3 aguardando sua decisão")).toHaveTextContent("3");
  });

  it("qualquer pessoa alcança 'Trocar senha', na barra lateral e no painel do celular", () => {
    render(<AppNav userName="Fulana" />);
    expect(sidebar().getByRole("link", { name: "Trocar senha" })).toHaveAttribute("href", "/trocar-senha");
    expect(hrefOf(moreSheet().getByText("Trocar senha"))).toBe("/trocar-senha");
  });

  it("a página aberta fica marcada (aria-current), inclusive nas telas de dentro dela", () => {
    pathname = "/eventos/abc/tarefas";
    render(<AppNav userName="Fulana" />);
    expect(sidebar().getByRole("link", { name: "Eventos" })).toHaveAttribute("aria-current", "page");
    expect(sidebar().getByRole("link", { name: "Painel" })).not.toHaveAttribute("aria-current");
  });

  it("celular: a barra de baixo leva as abas do dia a dia e 'Mais'; o resto e a conta ficam no painel", () => {
    render(<AppNav userName="Fulana" />);

    const bar = bottomBar();
    expect(bar.getAllByRole("link").map((a) => a.textContent)).toEqual(["Painel", "Eventos", "Conflitos", "Sincronização"]);
    expect(bar.getByRole("button", { name: "Mais" })).toHaveAttribute("aria-haspopup", "dialog");
    expect(bar.queryByRole("link", { name: "Aprovações" })).not.toBeInTheDocument();

    const sheet = moreSheet();
    expect(hrefOf(sheet.getByText("Aprovações"))).toBe("/aprovacoes");
    expect(sheet.queryByText("Painel")).not.toBeInTheDocument(); // já está na barra
    expect(sheet.getByText("Sair", { selector: "button" })).toBeInTheDocument();
  });

  it("celular: 'Mais' avisa que há pendência quando o que pede atenção está dentro dele", () => {
    render(<AppNav userName="Fulana" pendingApprovals={2} />);
    expect(bottomBar().getByRole("button", { name: "Mais, há itens que pedem atenção" })).toBeInTheDocument();
    expect(moreSheet().getByLabelText("2 aguardando sua decisão")).toHaveTextContent("2");

    cleanup();
    render(<AppNav userName="Fulana" />);
    expect(bottomBar().getByRole("button", { name: "Mais" })).toBeInTheDocument();
  });

  it("o menu tem dois botões 'Sair' (barra lateral e painel do celular): os ids dos diálogos não se repetem", () => {
    const { container } = render(<AppNav userName="Fulana" />);
    const ids = [...container.querySelectorAll("[id]")].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
