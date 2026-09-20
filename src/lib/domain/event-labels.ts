import type { EventStatus } from "./event.schema";

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  PLANNED: "Planejado",
  CONFIRMED: "Confirmado",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluído",
  CANCELLED: "Cancelado",
};

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
