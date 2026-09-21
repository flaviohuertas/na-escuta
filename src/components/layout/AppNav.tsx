"use client";

import { useEffect, useId, useRef } from "react";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { AppLink } from "@/components/ui/AppLink";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { LogoMark, Wordmark } from "@/components/ui/Logo";
import { buildNav, isNavActive, type NavItem } from "./nav-model";

const GROUP_LABEL = "px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em]";

function ApprovalsBadge({ count }: { count: number }) {
  return (
    <Badge tone="warning" className="ml-auto" aria-label={`${count} aguardando sua decisão`}>
      {count}
    </Badge>
  );
}

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavActive(pathname, item.href);
  return (
    <AppLink
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
        active ? "bg-white/15 font-semibold text-white" : "text-slate-200 hover:bg-white/10 hover:text-white"
      }`}
    >
      <Icon name={item.icon} size={18} />
      <span>{item.label}</span>
      {item.badge ? <ApprovalsBadge count={item.badge} /> : null}
    </AppLink>
  );
}

function TabLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavActive(pathname, item.href);
  return (
    <AppLink
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold ${
        active ? "text-brand-700" : "text-slate-500"
      }`}
    >
      {active && <span aria-hidden="true" className="absolute top-0 h-0.5 w-9 rounded-full bg-brand-600" />}
      <Icon name={item.icon} size={22} />
      {item.label}
    </AppLink>
  );
}

function SheetLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate: () => void }) {
  const active = isNavActive(pathname, item.href);
  return (
    <AppLink
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-12 items-center gap-3 rounded-xl px-3 text-base ${
        active ? "bg-brand-50 font-semibold text-brand-800" : "text-slate-700 hover:bg-slate-100"
      }`}
    >
      <Icon name={item.icon} size={20} />
      <span>{item.label}</span>
      {item.badge ? <ApprovalsBadge count={item.badge} /> : null}
    </AppLink>
  );
}

/**
 * O menu do app, em duas apresentações do MESMO conjunto de itens (montado por `buildNav`):
 *  - a partir de `md` (desktop/tablet): barra lateral escura, itens agrupados, conta no rodapé;
 *  - abaixo de `md` (celular): barra de abas embaixo, ao alcance do polegar, com "Mais" abrindo
 *    um painel com o resto e a conta.
 * Só uma das duas aparece por vez (a outra é `display: none`, fora da árvore de acessibilidade).
 * Some na impressão.
 */
export function AppNav({
  userName,
  canManageTeam = false,
  canManageCrm = false,
  canManageFinance = false,
  canManageSuppliers = false,
  pendingApprovals = 0,
}: {
  userName: string;
  canManageTeam?: boolean;
  /** O comercial (clientes e funil): só para quem cuida dele. */
  canManageCrm?: boolean;
  /** O financeiro (custo realizado e margem): só titular e administração. */
  canManageFinance?: boolean;
  /** O cadastro de fornecedores: titular, administração e produção. */
  canManageSuppliers?: boolean;
  /** Propostas esperando a decisão desta pessoa. */
  pendingApprovals?: number;
}) {
  const pathname = usePathname() ?? "";
  const { groups, tabs, more } = buildNav({ canManageTeam, canManageCrm, canManageFinance, canManageSuppliers, pendingApprovals });
  const sheetRef = useRef<HTMLDialogElement>(null);
  const sheetTitleId = useId();

  const openSheet = () => sheetRef.current?.showModal();
  const closeSheet = () => sheetRef.current?.close?.();

  // O menu mora no layout e não é recriado ao navegar: sem isto o "Mais" ficaria aberto na tela nova.
  useEffect(() => {
    sheetRef.current?.close?.();
  }, [pathname]);

  const moreNeedsAttention = more.some((g) => g.items.some((i) => (i.badge ?? 0) > 0));

  return (
    <>
      {/* Desktop e tablet */}
      <nav
        aria-label="Menu principal"
        className="hidden w-60 shrink-0 flex-col gap-6 bg-ink px-3 py-5 text-white print:hidden md:sticky md:top-0 md:flex md:h-dvh md:overflow-y-auto"
      >
        {/* Sem aria-label: o nome do link já é o texto "na escuta" (o ícone é decorativo). Um rótulo com
            "início" casaria com o campo "Início" dos formulários em getByLabel. */}
        <AppLink href="/eventos" className="flex items-center gap-2.5 px-2">
          <LogoMark size={32} tile="soft" />
          <Wordmark className="text-xl" />
        </AppLink>

        {groups.map((group) => (
          <div key={group.label}>
            <p className={`${GROUP_LABEL} text-ink-muted`}>{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.key}>
                  <SidebarLink item={item} pathname={pathname} />
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="mt-auto space-y-1 border-t border-white/10 pt-4">
          <p className="truncate px-3 pb-1 text-xs text-ink-muted">{userName}</p>
          <AppLink href="/trocar-senha" className="block rounded-lg px-3 py-2 text-sm text-slate-200 hover:bg-white/10 hover:text-white">
            Trocar senha
          </AppLink>
          <LogoutButton className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm text-slate-100 hover:bg-white/10" />
        </div>
      </nav>

      {/* Celular: barra de abas embaixo */}
      <nav
        aria-label="Menu principal (barra inferior)"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] print:hidden md:hidden"
      >
        <ul className="mx-auto flex max-w-xl">
          {tabs.map((item) => (
            <li key={item.key} className="flex-1">
              <TabLink item={item} pathname={pathname} />
            </li>
          ))}
          <li className="flex-1">
            <button
              type="button"
              onClick={openSheet}
              aria-haspopup="dialog"
              className="flex min-h-16 w-full flex-col items-center justify-center gap-1 text-xs font-semibold text-slate-500"
            >
              <span className="relative">
                <Icon name="mais" size={22} />
                {moreNeedsAttention && (
                  <span aria-hidden="true" className="absolute -right-1 -top-1 size-2.5 rounded-full bg-brand-600" />
                )}
              </span>
              Mais
              {moreNeedsAttention && <span className="sr-only">, há itens que pedem atenção</span>}
            </button>
          </li>
        </ul>
      </nav>

      {/* Celular: o resto do menu e a conta. Não pode levar `display` no próprio <dialog>. */}
      <dialog
        ref={sheetRef}
        aria-labelledby={sheetTitleId}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeSheet(); // clique no fundo escurecido
        }}
        className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-3xl bg-white p-0 text-ink shadow-xl backdrop:bg-black/50 print:hidden md:hidden"
      >
        <div className="px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
          <div className="flex items-center justify-between">
            <h2 id={sheetTitleId} className="pl-2 text-xl">
              Menu
            </h2>
            <button
              type="button"
              onClick={closeSheet}
              aria-label="Fechar menu"
              className="flex size-11 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100"
            >
              <Icon name="fechar" size={22} />
            </button>
          </div>

          {more.map((group) => (
            <div key={group.label} className="mt-3">
              <p className={`${GROUP_LABEL} text-slate-500`}>{group.label}</p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.key}>
                    <SheetLink item={item} pathname={pathname} onNavigate={closeSheet} />
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="mt-4 border-t border-line pt-4">
            <p className="px-3 pb-1 text-sm text-slate-500">{userName}</p>
            <AppLink
              href="/trocar-senha"
              onClick={closeSheet}
              className="flex min-h-12 items-center rounded-xl px-3 text-base text-slate-700 hover:bg-slate-100"
            >
              Trocar senha
            </AppLink>
            <LogoutButton className={buttonClass({ variant: "secondary", className: "mt-2 w-full" })} />
          </div>
        </div>
      </dialog>
    </>
  );
}
