import { describe, expect, it } from "vitest";
import { buildNav, isNavActive, TAB_COUNT, type NavKey, type NavPermissions } from "@/components/layout/nav-model";

const NONE: NavPermissions = { canManageTeam: false, canManageCrm: false, canManageFinance: false, canManageSuppliers: false, pendingApprovals: 0 };
const ALL: NavPermissions = { canManageTeam: true, canManageCrm: true, canManageFinance: true, canManageSuppliers: true, pendingApprovals: 0 };

const keys = (items: { key: NavKey }[]) => items.map((i) => i.key);
const groupKeys = (nav: ReturnType<typeof buildNav>["groups"]) => nav.map((g) => [g.label, keys(g.items)]);

describe("buildNav — o menu a partir do que a pessoa pode fazer", () => {
  it("titular: tudo, agrupado; na barra do celular ficam as quatro do dia a dia", () => {
    const nav = buildNav(ALL);
    expect(groupKeys(nav.groups)).toEqual([
      ["Operação", ["painel", "eventos"]],
      ["Negócios", ["comercial", "fornecedores"]],
      ["Gestão", ["financeiro", "aprovacoes"]],
      ["Sistema", ["conflitos", "sincronizacao", "equipe"]],
    ]);
    expect(keys(nav.tabs)).toEqual(["painel", "eventos", "comercial", "financeiro"]);
    expect(groupKeys(nav.more)).toEqual([
      ["Negócios", ["fornecedores"]],
      ["Gestão", ["aprovacoes"]],
      ["Sistema", ["conflitos", "sincronizacao", "equipe"]],
    ]);
  });

  it("equipe de campo: sem Comercial, Fornecedores, Financeiro nem Equipe — e o grupo vazio some", () => {
    const nav = buildNav(NONE);
    expect(groupKeys(nav.groups)).toEqual([
      ["Operação", ["painel", "eventos"]],
      ["Gestão", ["aprovacoes"]],
      ["Sistema", ["conflitos", "sincronizacao"]],
    ]);
    // Sem o escritório, a barra fica com o que o campo mais consulta sem sinal.
    expect(keys(nav.tabs)).toEqual(["painel", "eventos", "conflitos", "sincronizacao"]);
    expect(groupKeys(nav.more)).toEqual([["Gestão", ["aprovacoes"]]]);
  });

  it("produção: comercial e fornecedores, mas nada de financeiro", () => {
    const nav = buildNav({ ...NONE, canManageCrm: true, canManageSuppliers: true });
    const all = keys(nav.groups.flatMap((g) => g.items));
    expect(all).toContain("comercial");
    expect(all).toContain("fornecedores");
    expect(all).not.toContain("financeiro");
    expect(all).not.toContain("equipe");
    expect(keys(nav.tabs)).toEqual(["painel", "eventos", "comercial", "sincronizacao"]);
  });

  it.each([
    ["canManageCrm", "comercial"],
    ["canManageSuppliers", "fornecedores"],
    ["canManageFinance", "financeiro"],
    ["canManageTeam", "equipe"],
  ] as const)("%s liga %s e só ele", (flag, key) => {
    const withFlag = keys(buildNav({ ...NONE, [flag]: true }).groups.flatMap((g) => g.items));
    const without = keys(buildNav(NONE).groups.flatMap((g) => g.items));
    expect(withFlag).toContain(key);
    expect(without).not.toContain(key);
    // Nenhuma outra permissão vem junto.
    expect(withFlag.filter((k) => !without.includes(k))).toEqual([key]);
  });

  it("toda combinação de permissões: cada item aparece UMA vez, ou na barra ou em 'Mais'", () => {
    const flags = ["canManageTeam", "canManageCrm", "canManageFinance", "canManageSuppliers"] as const;
    for (let mask = 0; mask < 1 << flags.length; mask++) {
      const perms: NavPermissions = { ...NONE };
      flags.forEach((flag, i) => (perms[flag] = Boolean(mask & (1 << i))));

      const nav = buildNav(perms);
      const everything = keys(nav.groups.flatMap((g) => g.items)).sort();
      const split = [...keys(nav.tabs), ...keys(nav.more.flatMap((g) => g.items))].sort();

      expect(split).toEqual(everything);
      expect(new Set(split).size).toBe(split.length);
      expect(nav.tabs.length).toBeLessThanOrEqual(TAB_COUNT);
      // Enquanto houver item para preencher, a barra fica cheia.
      expect(nav.tabs.length).toBe(Math.min(TAB_COUNT, everything.length));
    }
  });

  it("o número de aprovações pendentes só aparece em 'Aprovações', e só quando passa de zero", () => {
    const flat = (n: ReturnType<typeof buildNav>) => n.groups.flatMap((g) => g.items);

    expect(flat(buildNav(ALL)).some((i) => "badge" in i)).toBe(false);

    const withPending = flat(buildNav({ ...ALL, pendingApprovals: 3 }));
    expect(withPending.filter((i) => i.badge !== undefined).map((i) => [i.key, i.badge])).toEqual([["aprovacoes", 3]]);
  });

  it("os endereços são os das telas de sempre", () => {
    const hrefs = Object.fromEntries(buildNav(ALL).groups.flatMap((g) => g.items).map((i) => [i.key, i.href]));
    expect(hrefs).toEqual({
      painel: "/painel",
      eventos: "/eventos",
      comercial: "/comercial",
      fornecedores: "/fornecedores",
      financeiro: "/financeiro",
      aprovacoes: "/aprovacoes",
      conflitos: "/conflitos",
      sincronizacao: "/configuracoes/sincronizacao",
      equipe: "/administracao/equipe",
    });
  });
});

describe("isNavActive", () => {
  it("acende na página e nas de dentro dela, e em mais nada", () => {
    expect(isNavActive("/eventos", "/eventos")).toBe(true);
    expect(isNavActive("/eventos/123/tarefas", "/eventos")).toBe(true);
    expect(isNavActive("/eventosx", "/eventos")).toBe(false);
    expect(isNavActive("/painel", "/eventos")).toBe(false);
    expect(isNavActive("", "/eventos")).toBe(false);
  });
});
