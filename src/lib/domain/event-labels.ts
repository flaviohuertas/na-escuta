import type { EventStatus } from "./event.schema";

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  PLANNED: "Planejado",
  CONFIRMED: "Confirmado",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};

/** Os campos do evento que uma proposta pode mexer, como a pessoa os conhece. */
export const EVENT_FIELD_LABEL = {
  name: "Nome",
  description: "Descrição",
  location: "Local",
  startDate: "Início",
  endDate: "Término",
  status: "Situação",
} as const;

export const EVENT_ROLE_LABEL: Record<string, string> = {
  MANAGER: "Gestor",
  FIELD_STAFF: "Equipe de campo",
  VIEWER: "Visualização",
};

export const COMPANY_ROLE_LABEL: Record<string, string> = {
  OWNER: "Titular",
  ADMIN: "Administração",
  PRODUCER: "Produção",
  STAFF: "Equipe",
  FREELANCER: "Freelancer",
  VIEWER: "Visualização",
};
