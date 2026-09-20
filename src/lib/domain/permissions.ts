/**
 * Quem pode o quê. Funções puras sobre os NOMES dos papéis (os mesmos dos enums `CompanyRole` e
 * `EventRole` do Prisma), sem importar o client gerado: o módulo serve ao servidor e ao navegador.
 *
 * Recebem `string` de propósito — um papel desconhecido (ex.: enum novo ainda não tratado aqui)
 * cai em "não pode", nunca em "pode".
 *
 * O servidor SEMPRE revalida no banco: o papel vem do `Membership`/`EventAccess` lidos na hora,
 * nunca do token de sessão (que continua válido depois de uma revogação).
 */

/** Papéis na empresa que criam eventos. Os demais só participam de eventos aos quais foram convidados. */
const COMPANY_ROLES_THAT_CREATE_EVENTS: ReadonlySet<string> = new Set(["OWNER", "ADMIN", "PRODUCER"]);

/** Papéis na empresa que administram pessoas e acessos. */
const COMPANY_ROLES_THAT_MANAGE_MEMBERS: ReadonlySet<string> = new Set(["OWNER", "ADMIN"]);

export function canCreateEvents(companyRole: string): boolean {
  return COMPANY_ROLES_THAT_CREATE_EVENTS.has(companyRole);
}

export function canManageMembers(companyRole: string): boolean {
  return COMPANY_ROLES_THAT_MANAGE_MEMBERS.has(companyRole);
}

/** Editar os dados do evento e convidar/remover pessoas dele: só o gestor do evento. */
export function canManageEvent(eventRole: string): boolean {
  return eventRole === "MANAGER";
}

export const COMPANY_ROLES = ["OWNER", "ADMIN", "PRODUCER", "STAFF", "FREELANCER", "VIEWER"] as const;
export type CompanyRoleName = (typeof COMPANY_ROLES)[number];

export const EVENT_ROLES = ["MANAGER", "FIELD_STAFF", "VIEWER"] as const;
export type EventRoleName = (typeof EVENT_ROLES)[number];

/**
 * Papéis de empresa que `actorRole` pode conceder. O titular concede qualquer um; a administração
 * só os de baixo (nunca titular nem administração — quem se promove a si mesmo ou a um par não
 * está delegando, está escalando). Os demais papéis não concedem nenhum.
 */
export function assignableCompanyRoles(actorRole: string): CompanyRoleName[] {
  if (actorRole === "OWNER") return [...COMPANY_ROLES];
  if (actorRole === "ADMIN") return ["PRODUCER", "STAFF", "FREELANCER", "VIEWER"];
  return [];
}

/**
 * Pode alterar (papel, revogar, reativar, redefinir senha) um membro que hoje tem `targetRole`?
 * O titular altera qualquer um; a administração só quem estaria ao alcance de conceder — nunca um
 * par nem um superior. (Alterar a si mesmo é barrado à parte, no serviço.)
 */
export function canModifyMember(actorRole: string, targetRole: string): boolean {
  return (assignableCompanyRoles(actorRole) as string[]).includes(targetRole);
}
