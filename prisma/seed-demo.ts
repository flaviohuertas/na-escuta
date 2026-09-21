import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import { BudgetSaveSchema } from "@/lib/domain/budget.schema";
import { ClientInputSchema, ConvertToEventSchema, OpportunityInputSchema, StageMoveSchema } from "@/lib/domain/crm.schema";
import { isValidCnpj, isValidCpf } from "@/lib/domain/crm";
import { ExpenseInputSchema, ExpenseVoidSchema } from "@/lib/domain/finance.schema";
import { todayInSaoPaulo } from "@/lib/domain/proposal";
import { ProposalActionSchema, ProposalInputSchema } from "@/lib/domain/proposal.schema";
import { SupplierInputSchema } from "@/lib/domain/supplier.schema";
import { saveBudget } from "@/server/crm/budget.service";
import { createClient } from "@/server/crm/client.service";
import { convertToEvent, createOpportunity, moveStage } from "@/server/crm/opportunity.service";
import { changeProposalStatus, createProposal } from "@/server/crm/proposal.service";
import { createExpense, voidExpense } from "@/server/finance/finance.service";
import { createSupplier, setSupplierArchived } from "@/server/suppliers/supplier.service";

/**
 * Dados de DEMONSTRAÇÃO do comercial, dos fornecedores e do financeiro — tudo fictício, para
 * ver o sistema cheio numa tela. Rode DEPOIS do `npm run db:seed` (que cria a empresa e o login):
 *
 *   npm run db:seed:demo
 *
 * Usa os serviços reais (as mesmas regras, validações e auditoria da tela), então o que aparece é
 * exatamente o que o sistema produziria. É idempotente (se já rodou, não faz nada) e RECUSA rodar
 * fora de um banco local. Antes de criar, remove os 6 registros de teste que uma execução
 * acidental de E2E deixou no banco de desenvolvimento — só esses, conferindo cada um.
 */

const PASSWORD = "NaEscuta#2026";
const FIRST_CLIENT = "Cervejaria Vale Verde";

// ---------------------------------------------------------------------------
// Ajudantes
// ---------------------------------------------------------------------------

/** Reais (com centavos opcionais) → centavos inteiros. */
const cents = (reais: number) => Math.round(reais * 100);

/** O dia de hoje em Brasília deslocado em `days` dias, como "2027-01-10". */
function dayOffset(days: number): string {
  const day = new Date(`${todayInSaoPaulo()}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** Um instante (ISO) no dia `days` a partir de hoje, na hora UTC dada. */
const at = (days: number, utcHour: number) => `${dayOffset(days)}T${String(utcHour).padStart(2, "0")}:00:00.000Z`;

/** CNPJ válido a partir de 12 dígitos-base (dígitos verificadores calculados). */
function makeCnpj(base12: string): string {
  const digit = (digits: number[], weights: number[]) => {
    const rest = digits.reduce((sum, d, i) => sum + d * weights[i]!, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const base = base12.split("").map(Number);
  const d1 = digit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digit([...base, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const cnpj = [...base, d1, d2].join("");
  if (!isValidCnpj(cnpj)) throw new Error(`CNPJ gerado inválido: ${cnpj}`);
  return cnpj;
}

/** CPF válido a partir de 9 dígitos-base. */
function makeCpf(base9: string): string {
  const check = (digits: number[]) => {
    let sum = 0;
    for (let i = 0; i < digits.length; i++) sum += digits[i]! * (digits.length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  const base = base9.split("").map(Number);
  const d1 = check(base);
  const d2 = check([...base, d1]);
  const cpf = [...base, d1, d2].join("");
  if (!isValidCpf(cpf)) throw new Error(`CPF gerado inválido: ${cpf}`);
  return cpf;
}

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  const host = /@([^:/?]+)/.exec(url)?.[1] ?? "";
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`Recusei rodar: DATABASE_URL não aponta para um banco local (host "${host || "?"}"). Este script só cria dados fictícios em desenvolvimento.`);
  }
}

/** Os 6 registros de teste que uma execução acidental de E2E deixou no banco de desenvolvimento. */
const ACCIDENTAL_OPPORTUNITIES: Array<[string, string]> = [
  ["41d4d6a9-a384-4ab4-b644-aff33386b6a1", "Perdida orçamento 1789941867194"],
  ["7cad0972-b384-40e3-9b09-705b31af97f5", "Orçamento E2E 1789941867184"],
  ["fd6a736d-9aec-45d0-a107-d442f79b3452", "Concorrência orçamento 1789941866981"],
];
const ACCIDENTAL_CLIENTS: Array<[string, string]> = [
  ["6e41ae67-f5fd-4caa-bbdc-5fe130d988e6", "Cliente Orçamento 1789941867184"],
  ["7cb0ba09-3a90-4c86-a1f5-454b8880c26c", "Cliente Orçamento Perdido 1789941867194"],
  ["ce86f400-7698-46d9-adf0-3b2cc7b48029", "Cliente Orçamento Concorrente 1789941866981"],
];

/**
 * Remove os registros de teste acidentais — SÓ se cada um ainda for exatamente o que foi criado
 * (mesmo nome, oportunidade ainda em "Novo", sem proposta, orçamento nem evento). Se qualquer
 * conferência falhar, não apaga NADA e avisa.
 */
async function removeAccidentalTestRecords(companyId: string): Promise<number> {
  const present: string[] = [];
  for (const [id, title] of ACCIDENTAL_OPPORTUNITIES) {
    const opportunity = await prisma.opportunity.findFirst({ where: { id, companyId }, include: { _count: { select: { proposals: true } }, budget: { select: { id: true } } } });
    if (!opportunity) continue;
    const untouched = opportunity.title === title && opportunity.stage === "NEW" && opportunity.eventId === null && opportunity._count.proposals === 0 && opportunity.budget === null;
    if (!untouched) {
      console.log(`  ! "${opportunity.title}" mudou desde o teste — não apaguei nenhum registro de teste.`);
      return 0;
    }
    present.push(id);
  }
  const clientIds: string[] = [];
  for (const [id, name] of ACCIDENTAL_CLIENTS) {
    const client = await prisma.client.findFirst({ where: { id, companyId }, include: { _count: { select: { opportunities: true } } } });
    if (!client) continue;
    if (client.name !== name) {
      console.log(`  ! O cliente "${client.name}" mudou desde o teste — não apaguei nenhum registro de teste.`);
      return 0;
    }
    clientIds.push(id);
  }
  if (present.length === 0 && clientIds.length === 0) return 0;

  await prisma.$transaction([
    prisma.opportunity.deleteMany({ where: { id: { in: present }, companyId } }),
    prisma.client.deleteMany({ where: { id: { in: clientIds }, companyId } }),
    prisma.auditLog.deleteMany({ where: { companyId, entityType: { in: ["Opportunity", "Client"] }, entityId: { in: [...present, ...clientIds] } } }),
  ]);
  return present.length + clientIds.length;
}

// ---------------------------------------------------------------------------
// Roteiro
// ---------------------------------------------------------------------------

async function main() {
  assertLocalDatabase();

  const company = await prisma.company.findUnique({ where: { slug: "produtora-demo" } });
  const owner = await prisma.user.findUnique({ where: { email: "demo@naescuta.com.br" } });
  if (!company || !owner) throw new Error("A empresa e o login de demonstração não existem. Rode primeiro: npm run db:seed");
  const ctx = { userId: owner.id, companyId: company.id };

  if (await prisma.client.findFirst({ where: { companyId: company.id, name: FIRST_CLIENT } })) {
    console.log("Os dados de demonstração já existem neste banco — nada a fazer.");
    return;
  }

  console.log("Montando os dados de demonstração (fictícios)…");
  const removed = await removeAccidentalTestRecords(company.id);
  if (removed > 0) console.log(`  • ${removed} registros de teste acidentais removidos (3 oportunidades e 3 clientes, com a auditoria deles).`);

  // ---- Uma pessoa de PRODUÇÃO, para ver o que quem não é titular/administração enxerga ----
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const producer = await prisma.user.upsert({
    where: { email: "produtor@naescuta.com.br" },
    update: {},
    create: { email: "produtor@naescuta.com.br", name: "Produtor Demo", passwordHash },
  });
  await prisma.membership.upsert({
    where: { userId_companyId: { userId: producer.id, companyId: company.id } },
    update: {},
    create: { userId: producer.id, companyId: company.id, role: "PRODUCER" },
  });
  const fieldStaff = await prisma.user.findUnique({ where: { email: "equipe@naescuta.com.br" } });

  // ---- Fornecedores ----
  const supplier = (name: string, extra: Record<string, unknown>) => createSupplier({ ...ctx, input: SupplierInputSchema.parse({ name, ...extra }) });
  const somLuz = await supplier("Som & Luz Alfa", { document: makeCnpj("112223330001"), contactName: "Ricardo Alves", email: "contato@somluzalfa.com.br", phone: "(31) 3222-1100", category: "AV", notes: "Aceita 50% de sinal e o restante na montagem." });
  const buffet = await supplier("Buffet Sabor & Cia", { document: makeCnpj("223334440001"), contactName: "Dona Maria Sabor", email: "vendas@buffetsabor.com.br", phone: "(31) 99999-0101", category: "FOOD", notes: "Degustação gratuita para contratos acima de 100 pessoas." });
  const seguranca = await supplier("Segurança Forte Ltda", { document: makeCnpj("334445550001"), contactName: "Sargento Almeida", email: "operacoes@segurancaforte.com.br", phone: "(31) 3555-0202", category: "SECURITY" });
  const estruturas = await supplier("Estruturas Palco Pro", { document: makeCnpj("445556660001"), contactName: "Marcos Tavares", email: "orcamentos@palcopro.com.br", phone: "(31) 3777-0303", category: "STRUCTURE", notes: "Prazo mínimo de 15 dias para montagem de cobertura." });
  const transportes = await supplier("Transportes Rota Certa", { document: makeCnpj("556667770001"), contactName: "Luciana", email: "fretes@rotacerta.com.br", phone: "(31) 3888-0404", category: "LOGISTICS" });
  await supplier("João Técnico de Palco", { kind: "PERSON", document: makeCpf("123456789"), contactName: "João", phone: "(31) 98888-0505", category: "STAFF", notes: "Freelancer: rigging e operação de mesa de luz." });
  const grafica = await supplier("Gráfica Antiga", { document: makeCnpj("667778880001"), email: "contato@graficaantiga.com.br", phone: "(31) 3999-0606", category: "MARKETING" });

  // ---- Clientes ----
  const client = (name: string, extra: Record<string, unknown>) => createClient({ ...ctx, input: ClientInputSchema.parse({ name, ...extra }) });
  const valeVerde = await client(FIRST_CLIENT, { document: makeCnpj("778889990001"), email: "eventos@valeverde.com.br", phone: "(31) 3111-0707", notes: "Cliente desde 2024. Contato principal: Renata (marketing)." });
  const anaBruno = await client("Ana Souza & Bruno Lima", { kind: "PERSON", document: makeCpf("987654321"), email: "ana.souza@exemplo.com.br", phone: "(31) 99777-0808" });
  const aurora = await client("Grupo Aurora Eventos", { document: makeCnpj("889990000001"), email: "compras@grupoaurora.com.br", phone: "(11) 4000-0909" });
  const colegio = await client("Colégio Novo Amanhã", { document: makeCnpj("990001110001"), email: "direcao@novoamanha.edu.br", phone: "(31) 3444-1010" });
  const horizonte = await client("Instituto Horizonte", { document: makeCnpj("001112220001"), email: "contato@institutohorizonte.org.br" });
  const lumiar = await client("Casa de Shows Lumiar", { document: makeCnpj("112223330002"), email: "producao@casalumiar.com.br", phone: "(31) 3666-1111" });

  // ---- Ajudantes de oportunidade, orçamento e proposta ----
  const opportunity = async (clientId: string, title: string, extra: { value?: number; startDays?: number; endDays?: number; description?: string }) =>
    createOpportunity({
      ...ctx,
      input: OpportunityInputSchema.parse({
        clientId,
        title,
        description: extra.description ?? null,
        expectedValueCents: extra.value !== undefined ? cents(extra.value) : null,
        expectedStartDate: extra.startDays !== undefined ? at(extra.startDays, 12) : null,
        expectedEndDate: extra.endDays !== undefined ? at(extra.endDays, 12) : null,
        ownerUserId: owner.id,
      }),
    });

  type Line = { category: string; description: string; quantity: number; unit: number; supplierId?: string; text?: string };
  const budget = (opportunityId: string, lines: Line[], notes: string | null) =>
    saveBudget({
      ...ctx,
      opportunityId,
      input: BudgetSaveSchema.parse({
        items: lines.map((line) => ({
          category: line.category,
          description: line.description,
          quantity: line.quantity,
          unitCostCents: cents(line.unit),
          supplierId: line.supplierId ?? null,
          supplier: line.supplierId ? null : (line.text ?? null),
        })),
        notes,
        baseVersion: 0,
      }),
    });

  /** Cria uma proposta e leva até onde pedido: rascunho, enviada, aceita ou recusada. Devolve o id e a versão final. */
  async function proposal(
    opportunityId: string,
    items: Array<{ description: string; quantity: number; unit: number }>,
    options: { discount?: number; validDays?: number; notes?: string; until: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED"; note?: string; copiedFrom?: string }
  ) {
    const draft = await createProposal({
      ...ctx,
      opportunityId,
      input: ProposalInputSchema.parse({
        items: items.map((item) => ({ description: item.description, quantity: item.quantity, unitPriceCents: cents(item.unit) })),
        discountCents: cents(options.discount ?? 0),
        validUntil: dayOffset(options.validDays ?? 20),
        notes: options.notes ?? null,
        copiedFromProposalId: options.copiedFrom ?? null,
      }),
    });
    let current = draft;
    const act = async (action: "SEND" | "ACCEPT" | "REJECT", note: string | null) => {
      const result = await changeProposalStatus({ ...ctx, proposalId: draft.id, input: ProposalActionSchema.parse({ action, baseVersion: current.version, note }) });
      current = result.proposal!;
    };
    if (options.until !== "DRAFT") await act("SEND", null);
    if (options.until === "ACCEPTED") await act("ACCEPT", options.note ?? null);
    if (options.until === "REJECTED") await act("REJECT", options.note ?? null);
    return { id: draft.id, version: current.version };
  }

  const move = async (opportunityId: string, stage: "CONTACTED" | "NEGOTIATION" | "LOST", lostReason: string | null = null) => {
    const current = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
    await moveStage({ ...ctx, opportunityId, input: StageMoveSchema.parse({ stage, lostReason, baseVersion: current.version }) });
  };

  const toEvent = async (opportunityId: string, event: { name: string; description: string; location: string; startDays: number; endDays: number }) => {
    const current = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });
    const result = await convertToEvent({
      ...ctx,
      opportunityId,
      input: ConvertToEventSchema.parse({
        event: { name: event.name, description: event.description, location: event.location, startDate: at(event.startDays, 15), endDate: at(event.endDays, 3), status: "CONFIRMED" },
        baseVersion: current.version,
      }),
    });
    return result.event;
  };

  const expense = (eventId: string, input: { category: string; description: string; amount: number; daysAgo: number; supplierId?: string; text?: string; notes?: string }) =>
    createExpense({
      ...ctx,
      eventId,
      input: ExpenseInputSchema.parse({
        category: input.category,
        description: input.description,
        supplierId: input.supplierId ?? null,
        supplier: input.supplierId ? null : (input.text ?? null),
        amountCents: cents(input.amount),
        expenseDate: dayOffset(-input.daysAgo),
        notes: input.notes ?? null,
      }),
    });

  /** Tarefas do evento (aparecem para o campo, no aparelho) e o acesso da equipe de campo. */
  const fieldWork = async (eventId: string, tasks: Array<{ title: string; status: "TODO" | "IN_PROGRESS" | "DONE"; priority: number; dueDays: number }>) => {
    if (fieldStaff) await prisma.eventAccess.create({ data: { userId: fieldStaff.id, eventId, role: "FIELD_STAFF", grantedBy: owner.id } });
    await prisma.task.createMany({
      data: tasks.map((task) => ({
        eventId,
        companyId: company.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueAt: new Date(at(task.dueDays, 15)),
        createdBy: owner.id,
        updatedBy: owner.id,
      })),
    });
  };

  // =========================================================================
  // A. Festival Vale Verde — GANHO e já virou EVENTO, com gasto real (estourou em três categorias)
  // =========================================================================
  const festival = await opportunity(valeVerde.id, "Festival Vale Verde 2027", { value: 180_000, startDays: 75, endDays: 77, description: "Festival de música e cerveja artesanal, 3 dias, capacidade de 8 mil pessoas." });
  await budget(
    festival.id,
    [
      { category: "STRUCTURE", description: "Palco principal 12 × 8 m com cobertura", quantity: 1, unit: 22_000, supplierId: estruturas.id },
      { category: "AV", description: "Sonorização e iluminação (pacote completo)", quantity: 1, unit: 34_000, supplierId: somLuz.id },
      { category: "AV", description: "Painel de LED 6 × 3 m", quantity: 1, unit: 9_500, supplierId: somLuz.id },
      { category: "FOOD", description: "Alimentação da equipe (refeições)", quantity: 180, unit: 45, supplierId: buffet.id },
      { category: "SECURITY", description: "Brigada e segurança (por dia)", quantity: 3, unit: 6_200, supplierId: seguranca.id },
      { category: "STAFF", description: "Técnicos de palco (diárias)", quantity: 36, unit: 260, text: "Equipe própria" },
      { category: "LOGISTICS", description: "Transporte de equipamentos", quantity: 1, unit: 7_800, supplierId: transportes.id },
      { category: "PERMITS", description: "Alvará, bombeiros e taxas", quantity: 1, unit: 4_200 },
      { category: "MARKETING", description: "Divulgação e materiais gráficos", quantity: 1, unit: 5_000, supplierId: grafica.id },
    ],
    "Premissas: montagem em 2 dias, desmontagem em 1. Sem headliner internacional."
  );
  await proposal(
    festival.id,
    [
      { description: "Produção completa do festival (palco, som, luz e segurança)", quantity: 1, unit: 140_000 },
      { description: "Equipe de produção e coordenação", quantity: 1, unit: 25_000 },
      { description: "Divulgação e mídias", quantity: 1, unit: 15_000 },
    ],
    { discount: 10_000, validDays: 30, notes: "Pagamento: 40% na assinatura, 40% 30 dias antes e 20% após o evento.", until: "ACCEPTED", note: "Assinado pela diretoria em reunião presencial." }
  );
  const festivalEvent = await toEvent(festival.id, {
    name: "Festival Vale Verde 2027",
    description: "Festival de música e cerveja artesanal — 3 dias. Evento de demonstração (dados fictícios).",
    location: "Parque das Águas, Belo Horizonte - MG",
    startDays: 75,
    endDays: 77,
  });
  await fieldWork(festivalEvent.id, [
    { title: "Fechar contrato com a Som & Luz Alfa", status: "IN_PROGRESS", priority: 2, dueDays: 10 },
    { title: "Enviar plano de montagem ao corpo de bombeiros", status: "TODO", priority: 2, dueDays: 25 },
    { title: "Contratar o seguro do evento", status: "DONE", priority: 1, dueDays: -9 },
  ]);
  await expense(festivalEvent.id, { category: "AV", description: "Som e luz — sinal de 50%", amount: 21_750, daysAgo: 14, supplierId: somLuz.id });
  await expense(festivalEvent.id, { category: "AV", description: "Adicional: 8 caixas de som de apoio", amount: 4_200, daysAgo: 6, supplierId: somLuz.id });
  await expense(festivalEvent.id, { category: "STRUCTURE", description: "Palco e cobertura — sinal + reforço estrutural", amount: 25_300, daysAgo: 9, supplierId: estruturas.id, notes: "Reforço pedido pelo laudo do engenheiro." });
  await expense(festivalEvent.id, { category: "FOOD", description: "Buffet da equipe — adiantamento", amount: 4_050, daysAgo: 5, supplierId: buffet.id });
  await expense(festivalEvent.id, { category: "LOGISTICS", description: "Frete de equipamentos (ida)", amount: 9_100, daysAgo: 3, supplierId: transportes.id });
  await expense(festivalEvent.id, { category: "MARKETING", description: "Materiais gráficos e banners", amount: 5_900, daysAgo: 20, supplierId: grafica.id });
  await expense(festivalEvent.id, { category: "OTHER", description: "Seguro do evento", amount: 3_400, daysAgo: 11, text: "Corretora Segura Vida" });
  const mistaken = await expense(festivalEvent.id, { category: "STRUCTURE", description: "Tenda extra (lançamento por engano)", amount: 8_000, daysAgo: 2, supplierId: estruturas.id });
  await voidExpense({ ...ctx, expenseId: mistaken.id, input: ExpenseVoidSchema.parse({ reason: "Lançado no evento errado", baseVersion: mistaken.version }) });

  // =========================================================================
  // B. Casamento Ana & Bruno — GANHO e EVENTO, tudo dentro do previsto
  // =========================================================================
  const wedding = await opportunity(anaBruno.id, "Casamento Ana & Bruno", { value: 62_000, startDays: 40, endDays: 41, description: "Cerimônia e festa para 120 convidados, chácara com exclusividade." });
  await budget(
    wedding.id,
    [
      { category: "VENUE", description: "Locação da chácara (exclusividade)", quantity: 1, unit: 12_000, text: "Chácara Ipê" },
      { category: "FOOD", description: "Buffet completo (por convidado)", quantity: 120, unit: 180, supplierId: buffet.id },
      { category: "AV", description: "Som ambiente e iluminação cênica", quantity: 1, unit: 5_500, supplierId: somLuz.id },
      { category: "STAFF", description: "Cerimonial e coordenação no dia", quantity: 1, unit: 3_800, text: "Cerimonial Bianca Torres" },
    ],
    null
  );
  await proposal(wedding.id, [{ description: "Produção e coordenação completa do casamento", quantity: 1, unit: 58_000 }], {
    discount: 3_000,
    validDays: 15,
    notes: "Entrada de 30% e o restante em 3 parcelas.",
    until: "ACCEPTED",
    note: "Fechado após a degustação.",
  });
  const weddingEvent = await toEvent(wedding.id, {
    name: "Casamento Ana & Bruno",
    description: "Casamento para 120 convidados. Evento de demonstração (dados fictícios).",
    location: "Chácara Ipê, Nova Lima - MG",
    startDays: 40,
    endDays: 41,
  });
  await fieldWork(weddingEvent.id, [
    { title: "Confirmar lista final de convidados", status: "TODO", priority: 2, dueDays: 20 },
    { title: "Prova do cardápio com o buffet", status: "DONE", priority: 1, dueDays: -4 },
  ]);
  await expense(weddingEvent.id, { category: "VENUE", description: "Chácara — sinal da reserva", amount: 6_000, daysAgo: 25, text: "Chácara Ipê" });
  await expense(weddingEvent.id, { category: "FOOD", description: "Buffet — sinal de 50%", amount: 10_800, daysAgo: 18, supplierId: buffet.id });
  await expense(weddingEvent.id, { category: "AV", description: "Som e iluminação — reserva de data", amount: 2_750, daysAgo: 10, supplierId: somLuz.id });

  // =========================================================================
  // C. Convenção Aurora — PROPOSTA ENVIADA (a v1 foi substituída pela v2)
  // =========================================================================
  const convention = await opportunity(aurora.id, "Convenção Anual Grupo Aurora", { value: 95_000, startDays: 60, endDays: 60, description: "Convenção de vendas para 200 pessoas, 1 dia." });
  await budget(
    convention.id,
    [
      { category: "STRUCTURE", description: "Montagem de auditório e palco", quantity: 1, unit: 18_000, supplierId: estruturas.id },
      { category: "AV", description: "Som, luz e projeção", quantity: 1, unit: 22_000, supplierId: somLuz.id },
      { category: "FOOD", description: "Coffee break e almoço (por pessoa)", quantity: 200, unit: 95, supplierId: buffet.id },
      { category: "STAFF", description: "Equipe de recepção e credenciamento", quantity: 1, unit: 6_000, text: "Equipe própria" },
      { category: "LOGISTICS", description: "Transporte e montagem", quantity: 1, unit: 4_500, supplierId: transportes.id },
    ],
    null
  );
  const v1 = await proposal(convention.id, [{ description: "Produção completa da convenção", quantity: 1, unit: 98_000 }], { validDays: 25, notes: "Válida por 25 dias.", until: "SENT" });
  await proposal(
    convention.id,
    [
      { description: "Produção da convenção (auditório, som, luz e projeção)", quantity: 1, unit: 80_000 },
      { description: "Coffee break e almoço", quantity: 1, unit: 22_000 },
    ],
    { discount: 10_000, validDays: 20, notes: "Nova versão após a negociação do escopo de alimentação.", until: "SENT", copiedFrom: v1.id }
  );

  // =========================================================================
  // D. Formatura — NEGOCIAÇÃO com rascunho de proposta: o custo passa da receita (prejuízo)
  // =========================================================================
  const graduation = await opportunity(colegio.id, "Formatura Colégio Novo Amanhã", { value: 30_000, startDays: 55, endDays: 55, description: "Baile de formatura, 150 convidados." });
  await budget(
    graduation.id,
    [
      { category: "VENUE", description: "Salão de festas (aluguel)", quantity: 1, unit: 14_000, text: "Salão Villa Real" },
      { category: "FOOD", description: "Jantar (formandos e convidados)", quantity: 150, unit: 85, supplierId: buffet.id },
      { category: "AV", description: "Som, DJ e iluminação", quantity: 1, unit: 6_500, supplierId: somLuz.id },
      { category: "STAFF", description: "Cerimonial e equipe de apoio", quantity: 1, unit: 3_250, text: "Equipe própria" },
    ],
    "Atenção: o cliente quer fechar por cerca de R$ 30 mil — abaixo do custo."
  );
  await proposal(graduation.id, [{ description: "Pacote formatura completo", quantity: 1, unit: 34_000 }], { validDays: 15, until: "DRAFT" });
  await move(graduation.id, "NEGOTIATION");

  // =========================================================================
  // E, F, G. O resto do funil
  // =========================================================================
  await opportunity(horizonte.id, "Feira de Ciências Instituto Horizonte", { value: 22_000, startDays: 120, endDays: 121, description: "Feira anual com 40 estandes." });
  const gig = await opportunity(lumiar.id, "Show Beneficente Casa Lumiar", { description: "Primeiro contato feito por telefone; aguardando briefing." });
  await move(gig.id, "CONTACTED");
  const gala = await opportunity(lumiar.id, "Noite de Gala Casa Lumiar", { value: 48_000, startDays: 90, endDays: 90 });
  await proposal(gala.id, [{ description: "Produção da noite de gala", quantity: 1, unit: 48_000 }], { validDays: 10, until: "REJECTED", note: "Achou caro e pediu um desconto que não cabia." });
  await move(gala.id, "LOST", "Escolheram outra produtora, com preço menor.");

  // ---- Arquivar um fornecedor antigo: some da lista e das opções novas, mas o que já o cita segue legível ----
  const archived = await prisma.supplier.findUniqueOrThrow({ where: { id: grafica.id } });
  await setSupplierArchived({ ...ctx, supplierId: grafica.id, archived: true, baseVersion: archived.version });

  console.log("\nPronto. Dados de demonstração criados:");
  console.log("  • 7 fornecedores (1 arquivado) · 6 clientes · 7 oportunidades em todas as etapas do funil");
  console.log("  • 2 eventos vindos de oportunidades (Festival Vale Verde 2027 e Casamento Ana & Bruno), com orçamento, proposta aceita e custos");
  console.log("  • Propostas: aceita ×2, enviada ×1 (v1 substituída pela v2), rascunho ×1 (dando prejuízo), recusada ×1");
  console.log("\nLogins (senha de todos: " + PASSWORD + "):");
  console.log("  demo@naescuta.com.br      titular — vê tudo");
  console.log("  produtor@naescuta.com.br  produção — comercial e fornecedores, sem custo/margem/financeiro");
  if (fieldStaff) console.log("  equipe@naescuta.com.br    equipe de campo — só os eventos que lhe deram acesso");
  else console.log("  (equipe@naescuta.com.br não existe neste banco: os dois eventos ficaram sem acesso de equipe de campo.)");
}

main()
  .catch((err) => {
    console.error("Falha ao montar os dados de demonstração:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
