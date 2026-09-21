import type { IconName } from "@/components/ui/Icon";

export type NavKey =
  | "painel"
  | "eventos"
  | "comercial"
  | "fornecedores"
  | "financeiro"
  | "aprovacoes"
  | "conflitos"
  | "sincronizacao"
  | "equipe";

export interface NavItem {
  key: NavKey;
  label: string;
  href: string;
  icon: IconName;
  /** Número que pede atenção (hoje: propostas esperando a decisão desta pessoa). */
  badge?: number;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface NavPermissions {
  canManageTeam: boolean;
  /** O comercial (clientes e funil). */
  canManageCrm: boolean;
  /** O financeiro: só titular e administração. */
  canManageFinance: boolean;
  /** O cadastro de fornecedores. */
  canManageSuppliers: boolean;
  pendingApprovals: number;
}

/** Quantas abas cabem na barra de baixo do celular, além do "Mais". */
export const TAB_COUNT = 4;

/**
 * Quem ganha lugar na barra de baixo, em ordem de prioridade entre os itens que a pessoa PODE ver:
 * o dia a dia do escritório primeiro; para a equipe de campo (que não tem Comercial nem Financeiro),
 * sobram Sincronização e Conflitos, que são o que ela mais consulta sem sinal.
 */
const TAB_PRIORITY: readonly NavKey[] = [
  "painel",
  "eventos",
  "comercial",
  "financeiro",
  "sincronizacao",
  "conflitos",
  "fornecedores",
  "aprovacoes",
  "equipe",
];

/**
 * O menu inteiro a partir do que a pessoa pode fazer. Nada aparece "desabilitado": o que ela não
 * pode usar simplesmente não está aqui (a guarda de verdade continua no servidor, em cada tela).
 */
export function buildNav(p: NavPermissions): {
  /** Tudo, agrupado — o menu lateral do desktop. */
  groups: NavGroup[];
  /** As abas da barra de baixo do celular, na ordem do menu. */
  tabs: NavItem[];
  /** O resto, agrupado — o que abre em "Mais". */
  more: NavGroup[];
} {
  const all: NavGroup[] = [
    {
      label: "Operação",
      items: [
        { key: "painel", label: "Painel", href: "/painel", icon: "painel" },
        { key: "eventos", label: "Eventos", href: "/eventos", icon: "eventos" },
      ],
    },
    {
      label: "Negócios",
      items: [
        ...(p.canManageCrm ? [{ key: "comercial", label: "Comercial", href: "/comercial", icon: "comercial" } satisfies NavItem] : []),
        ...(p.canManageSuppliers
          ? [{ key: "fornecedores", label: "Fornecedores", href: "/fornecedores", icon: "fornecedores" } satisfies NavItem]
          : []),
      ],
    },
    {
      label: "Gestão",
      items: [
        ...(p.canManageFinance ? [{ key: "financeiro", label: "Financeiro", href: "/financeiro", icon: "financeiro" } satisfies NavItem] : []),
        {
          key: "aprovacoes",
          label: "Aprovações",
          href: "/aprovacoes",
          icon: "aprovacoes",
          ...(p.pendingApprovals > 0 ? { badge: p.pendingApprovals } : {}),
        },
      ],
    },
    {
      label: "Sistema",
      items: [
        { key: "conflitos", label: "Conflitos", href: "/conflitos", icon: "conflitos" },
        { key: "sincronizacao", label: "Sincronização", href: "/configuracoes/sincronizacao", icon: "sincronizacao" },
        ...(p.canManageTeam ? [{ key: "equipe", label: "Equipe", href: "/administracao/equipe", icon: "equipe" } satisfies NavItem] : []),
      ],
    },
  ];
  const groups = all.filter((group) => group.items.length > 0);

  const visible = new Set(groups.flatMap((g) => g.items.map((i) => i.key)));
  const onTheBar = new Set(TAB_PRIORITY.filter((key) => visible.has(key)).slice(0, TAB_COUNT));

  return {
    groups,
    tabs: groups.flatMap((g) => g.items).filter((i) => onTheBar.has(i.key)),
    more: groups
      .map((g) => ({ label: g.label, items: g.items.filter((i) => !onTheBar.has(i.key)) }))
      .filter((g) => g.items.length > 0),
  };
}

/** O item está aberto? `/eventos/123/tarefas` mantém "Eventos" aceso; `/eventosx` não. */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
