/**
 * Fornecedores (integração — Postgres real, ver cabeçalho de sync-push.integration.test.ts).
 *
 * O que importa: o CADASTRO é de titular, administração e produção; o DINHEIRO por fornecedor é só
 * de quem vê o financeiro; nunca se mexe em fornecedor de outra empresa; um fornecedor nunca é
 * apagado (arquiva-se) e um arquivado nunca recebe vínculo NOVO — nem numa corrida —; o nome nos
 * orçamentos e lançamentos acompanha o cadastro; e duas pessoas mexendo ao mesmo tempo nunca se
 * sobrescrevem.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMembership,
  createTestCompany,
  createTestEvent,
  createTestPrismaClient,
  createTestUser,
  truncateAll,
} from "../helpers/factories";
import { getBudget, saveBudget } from "@/server/crm/budget.service";
import { createClient } from "@/server/crm/client.service";
import { createOpportunity, getOpportunity } from "@/server/crm/opportunity.service";
import { createExpense, updateExpense } from "@/server/finance/finance.service";
import { lockSupplier } from "@/server/suppliers/access";
import {
  createSupplier,
  getSupplier,
  getSupplierSpend,
  listSupplierOptions,
  listSuppliers,
  setSupplierArchived,
  updateSupplier,
} from "@/server/suppliers/supplier.service";

const prisma = createTestPrismaClient();

type CompanyRole = "OWNER" | "ADMIN" | "PRODUCER" | "STAFF" | "FREELANCER" | "VIEWER";
type Ctx = { userId: string; companyId: string };

const adminError = (status: number) => expect.objectContaining({ name: "AdminActionError", status });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const CNPJ = "06990590000123";
const CNPJ_2 = "11222333000181";
const CPF = "52998224725";

const supplierInput = (overrides: Record<string, unknown> = {}) =>
  ({ name: "Som Alfa", kind: "COMPANY", document: null, contactName: null, email: null, phone: null, category: null, notes: null, ...overrides }) as never;
const updateInput = (baseVersion: number, overrides: Record<string, unknown> = {}) => ({ ...(supplierInput(overrides) as object), baseVersion }) as never;

const expenseInput = (overrides: Record<string, unknown> = {}) =>
  ({ category: "AV", description: "Sonorização", supplier: null, supplierId: null, amountCents: 300_000, expenseDate: "2027-01-08", notes: null, ...overrides }) as never;

const budgetItem = (overrides: Record<string, unknown> = {}) => ({ category: "AV", description: "Sonorização", quantity: 2, unitCostCents: 300_000, supplier: null, supplierId: null, ...overrides });
const budgetInput = (items: unknown[], baseVersion = 0) => ({ items, notes: null, baseVersion }) as never;

describe("fornecedores (integração — Postgres real)", () => {
  beforeEach(async () => {
    await truncateAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function person(companyId: string, role: CompanyRole = "ADMIN") {
    const user = await createTestUser(prisma);
    await createMembership(prisma, user.id, companyId, role);
    return user;
  }

  async function setup() {
    const company = await createTestCompany(prisma);
    const owner = await person(company.id, "OWNER");
    const event = await createTestEvent(prisma, company.id);
    return { company, owner, event, ctx: { userId: owner.id, companyId: company.id } as Ctx };
  }

  const add = (ctx: Ctx, overrides: Record<string, unknown> = {}) => createSupplier({ ...ctx, input: supplierInput(overrides) });

  async function opportunityFor(ctx: Ctx) {
    const client = await createClient({ ...ctx, input: { name: `Cliente ${Math.random().toString(36).slice(2, 8)}`, kind: "COMPANY", document: null, email: null, phone: null, notes: null } as never });
    return createOpportunity({
      ...ctx,
      input: { clientId: client.id, title: `Oportunidade ${Math.random().toString(36).slice(2, 6)}`, description: null, expectedValueCents: null, expectedStartDate: null, expectedEndDate: null, ownerUserId: null } as never,
    });
  }

  describe("quem acessa", () => {
    it("titular, administração e produção cuidam do cadastro", async () => {
      const { company, ctx } = await setup();
      for (const role of ["OWNER", "ADMIN", "PRODUCER"] as const) {
        const user = await person(company.id, role);
        const c = { userId: user.id, companyId: company.id };
        const created = await add(c, { name: `Do ${role}` });
        expect(created).toMatchObject({ name: `Do ${role}`, createdBy: user.id });
        await expect(getSupplier({ ...c, supplierId: created.id }), role).resolves.toMatchObject({ supplier: { id: created.id } });
      }
      expect((await listSuppliers(ctx)).rows).toHaveLength(3);
    });

    it("equipe, freelancer e visualização NÃO acessam o cadastro (403) — em nenhuma função", async () => {
      const { company, ctx } = await setup();
      const supplier = await add(ctx);

      for (const role of ["STAFF", "FREELANCER", "VIEWER"] as const) {
        const user = await person(company.id, role);
        const c = { userId: user.id, companyId: company.id };
        const calls: Array<[string, () => Promise<unknown>]> = [
          ["listSuppliers", () => listSuppliers(c)],
          ["listSupplierOptions", () => listSupplierOptions(c)],
          ["getSupplier", () => getSupplier({ ...c, supplierId: supplier.id })],
          ["createSupplier", () => add(c)],
          ["updateSupplier", () => updateSupplier({ ...c, supplierId: supplier.id, input: updateInput(1, { name: "Invadido" }) })],
          ["setSupplierArchived", () => setSupplierArchived({ ...c, supplierId: supplier.id, archived: true, baseVersion: 1 })],
          ["getSupplierSpend", () => getSupplierSpend({ ...c, supplierId: supplier.id })],
        ];
        for (const [name, call] of calls) {
          await expect(call(), `${role} → ${name}`).rejects.toEqual(adminError(403));
        }
      }
      expect(await prisma.supplier.count()).toBe(1);
      expect((await prisma.supplier.findFirstOrThrow()).name).toBe("Som Alfa");
    });

    it("o DINHEIRO por fornecedor é só de titular e administração: a produção mantém o cadastro mas leva 403 no gasto", async () => {
      const { company, ctx } = await setup();
      const supplier = await add(ctx);
      const producer = await person(company.id, "PRODUCER");
      const admin = await person(company.id, "ADMIN");
      const p = { userId: producer.id, companyId: company.id };

      // A produção lê e edita o cadastro...
      await expect(getSupplier({ ...p, supplierId: supplier.id })).resolves.toMatchObject({ supplier: { name: "Som Alfa" } });
      await expect(updateSupplier({ ...p, supplierId: supplier.id, input: updateInput(1, { phone: "(31) 3000-0000" }) })).resolves.toMatchObject({ phone: "(31) 3000-0000" });
      // ...mas o que se gastou e se orçou com ele é do financeiro.
      await expect(getSupplierSpend({ ...p, supplierId: supplier.id })).rejects.toEqual(adminError(403));
      await expect(getSupplierSpend({ userId: admin.id, companyId: company.id, supplierId: supplier.id })).resolves.toMatchObject({ realized: [], planned: [] });
    });

    it("quem vê o financeiro sempre vê o cadastro (o gasto nunca é mais aberto que o cadastro)", async () => {
      const { canManageFinance, canManageSuppliers } = await import("@/lib/domain/permissions");
      for (const role of ["OWNER", "ADMIN", "PRODUCER", "STAFF", "FREELANCER", "VIEWER"]) {
        if (canManageFinance(role)) expect(canManageSuppliers(role), role).toBe(true);
      }
    });

    it("vínculo encerrado e rebaixamento: 403 na chamada seguinte (o papel é lido do banco)", async () => {
      const { company } = await setup();
      const admin = await person(company.id, "ADMIN");
      const c = { userId: admin.id, companyId: company.id };
      await expect(add(c)).resolves.toMatchObject({ version: 1 });

      await prisma.membership.updateMany({ where: { userId: admin.id }, data: { role: "STAFF" } });
      await expect(add(c, { name: "Outro" })).rejects.toEqual(adminError(403));
      await prisma.membership.updateMany({ where: { userId: admin.id }, data: { role: "ADMIN", status: "REVOKED" } });
      await expect(listSuppliers(c)).rejects.toEqual(adminError(403));
    });

    it("quem é de OUTRA empresa não enxerga, edita, arquiva nem vê o gasto do fornecedor desta (404)", async () => {
      const { ctx } = await setup();
      const supplier = await add(ctx, { name: "Do fulano" });
      const other = await createTestCompany(prisma);
      const outsider = await person(other.id, "OWNER");
      const theirs = { userId: outsider.id, companyId: other.id };

      await expect(getSupplier({ ...theirs, supplierId: supplier.id })).rejects.toEqual(adminError(404));
      await expect(updateSupplier({ ...theirs, supplierId: supplier.id, input: updateInput(1, { name: "Invadido" }) })).rejects.toEqual(adminError(404));
      await expect(setSupplierArchived({ ...theirs, supplierId: supplier.id, archived: true, baseVersion: 1 })).rejects.toEqual(adminError(404));
      await expect(getSupplierSpend({ ...theirs, supplierId: supplier.id })).rejects.toEqual(adminError(404));
      expect((await listSuppliers(theirs)).rows).toEqual([]);
      expect(await listSupplierOptions(theirs)).toEqual([]);
      expect(await prisma.supplier.findFirstOrThrow()).toMatchObject({ name: "Do fulano", archivedAt: null, version: 1 });
    });
  });

  describe("cadastro", () => {
    it("grava o documento só com os dígitos, o tipo, o contato e a categoria, e audita", async () => {
      const { ctx } = await setup();

      const created = await add(ctx, { name: "Buffet Sabor", document: CNPJ, contactName: "Dona Maria", email: "contato@sabor.com", phone: "(31) 99999-0000", category: "FOOD", notes: "Aceita PIX" });

      expect(created).toMatchObject({ name: "Buffet Sabor", kind: "COMPANY", document: CNPJ, contactName: "Dona Maria", category: "FOOD", version: 1, archivedAt: null });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "Supplier", entityId: created.id } });
      expect(audit).toMatchObject({ action: "SUPPLIER_CREATED", userId: ctx.userId, companyId: ctx.companyId });
      expect(audit.afterJson).toMatchObject({ name: "Buffet Sabor", document: CNPJ, category: "FOOD", archived: false });
    });

    it("o documento é único por empresa: o duplicado é recusado dizendo QUEM tem (e manda reativar se está arquivado)", async () => {
      const { company, ctx } = await setup();
      const first = await add(ctx, { name: "Original", document: CNPJ });

      await expect(add(ctx, { name: "Duplicado", document: CNPJ })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Original") });
      await setSupplierArchived({ ...ctx, supplierId: first.id, archived: true, baseVersion: 1 });
      await expect(add(ctx, { name: "Duplicado", document: CNPJ })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("arquivado") });
      // Outra empresa pode cadastrar o mesmo documento; e vários sem documento convivem.
      const other = await createTestCompany(prisma);
      const outsider = await person(other.id, "OWNER");
      await expect(add({ userId: outsider.id, companyId: other.id }, { document: CNPJ })).resolves.toMatchObject({ document: CNPJ });
      await add(ctx, { name: "Sem documento A" });
      await add(ctx, { name: "Sem documento B" });
      expect(await prisma.supplier.count({ where: { companyId: company.id } })).toBe(3);
    });

    it("editar: troca os campos, sobe a versão e audita; versão velha recebe 409 e não sobrescreve", async () => {
      const { ctx } = await setup();
      const created = await add(ctx, { name: "Som Alfa" });

      const updated = await updateSupplier({ ...ctx, supplierId: created.id, input: updateInput(1, { name: "Som Alfa", phone: "(31) 3000-0000", category: "AV" }) });
      expect(updated).toMatchObject({ version: 2, phone: "(31) 3000-0000", category: "AV", updatedBy: ctx.userId });

      await expect(updateSupplier({ ...ctx, supplierId: created.id, input: updateInput(1, { name: "Som Alfa", phone: "OUTRO" }) })).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("alterado por outra pessoa"),
      });
      expect((await prisma.supplier.findFirstOrThrow()).phone).toBe("(31) 3000-0000");
    });

    it("editar para um documento que já é de OUTRO fornecedor: 409 dizendo quem", async () => {
      const { ctx } = await setup();
      await add(ctx, { name: "Dono do CNPJ", document: CNPJ });
      const other = await add(ctx, { name: "Outro", document: CNPJ_2 });

      await expect(updateSupplier({ ...ctx, supplierId: other.id, input: updateInput(1, { name: "Outro", document: CNPJ }) })).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("Dono do CNPJ"),
      });
      expect((await prisma.supplier.findUniqueOrThrow({ where: { id: other.id } })).document).toBe(CNPJ_2);
    });

    it("arquivar e reativar: nunca apaga, o arquivado não se edita, e repetir a ação é 409", async () => {
      const { ctx } = await setup();
      const created = await add(ctx);

      const archived = await setSupplierArchived({ ...ctx, supplierId: created.id, archived: true, baseVersion: 1 });
      expect(archived.archivedAt).toBeInstanceOf(Date);
      expect(await prisma.supplier.count()).toBe(1); // nada foi apagado
      await expect(updateSupplier({ ...ctx, supplierId: created.id, input: updateInput(2, { name: "Tentando" }) })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("arquivado") });
      await expect(setSupplierArchived({ ...ctx, supplierId: created.id, archived: true, baseVersion: 2 })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("já está arquivado") });
      await expect(setSupplierArchived({ ...ctx, supplierId: created.id, archived: false, baseVersion: 1 })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("alterado por outra pessoa") });

      const restored = await setSupplierArchived({ ...ctx, supplierId: created.id, archived: false, baseVersion: 2 });
      expect(restored).toMatchObject({ archivedAt: null, version: 3 });
      const actions = (await prisma.auditLog.findMany({ where: { entityType: "Supplier" }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
      expect(actions).toEqual(["SUPPLIER_CREATED", "SUPPLIER_ARCHIVED", "SUPPLIER_RESTORED"]);
    });
  });

  describe("busca e listas", () => {
    it("procura no nome, no contato, no e-mail e no documento (com ou sem máscara), sem diferenciar maiúsculas", async () => {
      const { ctx } = await setup();
      await add(ctx, { name: "Buffet Sabor", document: CNPJ, contactName: "Dona Maria", email: "vendas@sabor.com" });
      await add(ctx, { name: "Segurança Forte", contactName: "Seu Zé", document: CPF, kind: "PERSON" });

      const names = async (search: string) => (await listSuppliers({ ...ctx, search })).rows.map((r) => r.name);
      expect(await names("buffet")).toEqual(["Buffet Sabor"]);
      expect(await names("MARIA")).toEqual(["Buffet Sabor"]);
      expect(await names("vendas@")).toEqual(["Buffet Sabor"]);
      expect(await names("06.990.590/0001-23")).toEqual(["Buffet Sabor"]);
      expect(await names("529.982.247-25")).toEqual(["Segurança Forte"]);
      expect(await names("zé")).toEqual(["Segurança Forte"]);
      expect(await names("nada disso")).toEqual([]);
    });

    it("filtra pela categoria principal; arquivados só quando pedidos; por nome", async () => {
      const { ctx } = await setup();
      await add(ctx, { name: "Zeta Som", category: "AV" });
      const gone = await add(ctx, { name: "Alfa Som", category: "AV" });
      await add(ctx, { name: "Comida Boa", category: "FOOD" });
      await setSupplierArchived({ ...ctx, supplierId: gone.id, archived: true, baseVersion: 1 });

      expect((await listSuppliers({ ...ctx, category: "AV" })).rows.map((r) => r.name)).toEqual(["Zeta Som"]);
      expect((await listSuppliers({ ...ctx, category: "AV", includeArchived: true })).rows.map((r) => [r.name, r.archived])).toEqual([["Alfa Som", true], ["Zeta Som", false]]);
      expect((await listSuppliers(ctx)).rows.map((r) => r.name)).toEqual(["Comida Boa", "Zeta Som"]);
    });

    it("as opções para escolher: os ativos, e os arquivados só se o registro já os cita", async () => {
      const { ctx } = await setup();
      await add(ctx, { name: "Ativo" });
      const old = await add(ctx, { name: "Antigo" });
      await add(ctx, { name: "Arquivado sem uso" }).then((s) => setSupplierArchived({ ...ctx, supplierId: s.id, archived: true, baseVersion: 1 }));
      await setSupplierArchived({ ...ctx, supplierId: old.id, archived: true, baseVersion: 1 });

      expect((await listSupplierOptions(ctx)).map((o) => o.name)).toEqual(["Ativo"]);
      expect((await listSupplierOptions({ ...ctx, alsoIds: [old.id] })).map((o) => [o.name, o.archived])).toEqual([["Antigo", true], ["Ativo", false]]);
    });
  });

  describe("vínculo com o orçamento", () => {
    it("o item vinculado guarda o id E o nome do cadastro (o texto livre é ignorado)", async () => {
      const { ctx } = await setup();
      const opp = await opportunityFor(ctx);
      const supplier = await add(ctx, { name: "Som Alfa" });

      const saved = await saveBudget({ ...ctx, opportunityId: opp.id, input: budgetInput([budgetItem({ supplierId: supplier.id, supplier: "Texto que deve ser ignorado" }), budgetItem({ description: "Sem vínculo", supplier: "Fornecedor avulso" })]) });

      expect(saved.items.map((i) => [i.supplierId, i.supplier])).toEqual([[supplier.id, "Som Alfa"], [null, "Fornecedor avulso"]]);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "Budget", entityId: saved.id } });
      expect(audit.afterJson).toMatchObject({ items: [{ supplierId: supplier.id, supplier: "Som Alfa" }, { supplierId: null, supplier: "Fornecedor avulso" }] });
    });

    it("fornecedor de OUTRA empresa ou que não existe: 422 e nada é salvo (não revela que existe)", async () => {
      const { ctx } = await setup();
      const opp = await opportunityFor(ctx);
      const other = await createTestCompany(prisma);
      const outsider = await person(other.id, "OWNER");
      const foreign = await add({ userId: outsider.id, companyId: other.id }, { name: "Alheio" });

      for (const supplierId of [foreign.id, "00000000-0000-4000-8000-000000000000"]) {
        await expect(saveBudget({ ...ctx, opportunityId: opp.id, input: budgetInput([budgetItem({ supplierId })]) })).rejects.toEqual(adminError(422));
      }
      expect(await prisma.budget.count()).toBe(0);
    });

    it("um ARQUIVADO não recebe vínculo NOVO (409), mas o vínculo que já existia segue valendo ao editar o resto", async () => {
      const { ctx } = await setup();
      const opp = await opportunityFor(ctx);
      const linked = await add(ctx, { name: "Antigo parceiro" });
      const other = await add(ctx, { name: "Outro parceiro" });
      await saveBudget({ ...ctx, opportunityId: opp.id, input: budgetInput([budgetItem({ supplierId: linked.id })]) });
      await setSupplierArchived({ ...ctx, supplierId: linked.id, archived: true, baseVersion: 1 });
      await setSupplierArchived({ ...ctx, supplierId: other.id, archived: true, baseVersion: 1 });

      // Novo vínculo com um arquivado: recusado, dizendo quem.
      await expect(
        saveBudget({ ...ctx, opportunityId: opp.id, input: budgetInput([budgetItem({ supplierId: linked.id }), budgetItem({ description: "Novo", supplierId: other.id })], 1) })
      ).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Outro parceiro") });
      // Editar o que já estava vinculado ao arquivado (mudar a quantidade) passa.
      const edited = await saveBudget({ ...ctx, opportunityId: opp.id, input: budgetInput([budgetItem({ supplierId: linked.id, quantity: 5 })], 1) });
      expect(edited).toMatchObject({ version: 2 });
      expect(edited.items[0]).toMatchObject({ supplierId: linked.id, supplier: "Antigo parceiro", quantity: 5 });
    });

    it("desvincular (voltar ao texto livre) funciona", async () => {
      const { ctx } = await setup();
      const opp = await opportunityFor(ctx);
      const supplier = await add(ctx, { name: "Som Alfa" });
      await saveBudget({ ...ctx, opportunityId: opp.id, input: budgetInput([budgetItem({ supplierId: supplier.id })]) });

      const saved = await saveBudget({ ...ctx, opportunityId: opp.id, input: budgetInput([budgetItem({ supplierId: null, supplier: "Agora avulso" })], 1) });

      expect(saved.items[0]).toMatchObject({ supplierId: null, supplier: "Agora avulso" });
    });
  });

  describe("vínculo com os lançamentos", () => {
    it("o lançamento vinculado guarda o id E o nome do cadastro", async () => {
      const { ctx, event } = await setup();
      const supplier = await add(ctx, { name: "Buffet Sabor" });

      const created = await createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id, supplier: "ignorado" }) });

      expect(created).toMatchObject({ supplierId: supplier.id, supplier: "Buffet Sabor" });
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "EventExpense", entityId: created.id } });
      expect(audit.afterJson).toMatchObject({ supplierId: supplier.id, supplier: "Buffet Sabor" });
    });

    it("de outra empresa: 422; arquivado: 409 no lançamento novo, mas o lançamento antigo segue editável com o mesmo vínculo", async () => {
      const { ctx, event } = await setup();
      const other = await createTestCompany(prisma);
      const outsider = await person(other.id, "OWNER");
      const foreign = await add({ userId: outsider.id, companyId: other.id }, { name: "Alheio" });
      const supplier = await add(ctx, { name: "Parceiro" });
      const kept = await createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id }) });
      await setSupplierArchived({ ...ctx, supplierId: supplier.id, archived: true, baseVersion: 1 });

      await expect(createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: foreign.id }) })).rejects.toEqual(adminError(422));
      await expect(createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id }) })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Parceiro") });
      const edited = await updateExpense({ ...ctx, expenseId: kept.id, input: { ...(expenseInput({ supplierId: supplier.id, amountCents: 123_456 }) as object), baseVersion: 1 } as never });
      expect(edited).toMatchObject({ supplierId: supplier.id, amountCents: 123_456, version: 2 });
      expect(await prisma.eventExpense.count()).toBe(1);
    });
  });

  describe("renomear acompanha os registros", () => {
    it("o nome guardado nos itens de orçamento e lançamentos LIGADOS ao fornecedor acompanha; o texto livre igual NÃO", async () => {
      const { ctx, event } = await setup();
      const opp = await opportunityFor(ctx);
      const supplier = await add(ctx, { name: "Som Alfa" });
      await saveBudget({ ...ctx, opportunityId: opp.id, input: budgetInput([budgetItem({ supplierId: supplier.id }), budgetItem({ description: "Avulso", supplier: "Som Alfa" })]) });
      const linked = await createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id }) });
      const free = await createExpense({ ...ctx, eventId: event.id, input: expenseInput({ description: "Texto livre", supplier: "Som Alfa" }) });

      await updateSupplier({ ...ctx, supplierId: supplier.id, input: updateInput(1, { name: "Som Alfa Ltda" }) });

      const items = await prisma.budgetItem.findMany({ orderBy: { position: "asc" } });
      expect(items.map((i) => [i.supplierId === supplier.id, i.supplier])).toEqual([[true, "Som Alfa Ltda"], [false, "Som Alfa"]]);
      expect((await prisma.eventExpense.findUniqueOrThrow({ where: { id: linked.id } })).supplier).toBe("Som Alfa Ltda");
      expect((await prisma.eventExpense.findUniqueOrThrow({ where: { id: free.id } })).supplier).toBe("Som Alfa");
      // Só o NOME muda: nem a versão nem o valor do lançamento (é o mesmo lançamento).
      expect(await prisma.eventExpense.findUniqueOrThrow({ where: { id: linked.id } })).toMatchObject({ version: 1, amountCents: 300_000 });
    });

    it("a auditoria diz em quantos registros o nome foi atualizado, e o histórico conta em palavras", async () => {
      const { ctx, event } = await setup();
      const opp = await opportunityFor(ctx);
      const supplier = await add(ctx, { name: "Som Alfa" });
      await saveBudget({ ...ctx, opportunityId: opp.id, input: budgetInput([budgetItem({ supplierId: supplier.id }), budgetItem({ description: "Outro", supplierId: supplier.id })]) });
      await createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id }) });

      await updateSupplier({ ...ctx, supplierId: supplier.id, input: updateInput(1, { name: "Som Alfa Ltda", phone: "(31) 3000-0000" }) });

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: supplier.id, action: "SUPPLIER_UPDATED" } });
      expect(audit.metadata).toMatchObject({ renamedBudgetItems: 2, renamedExpenses: 1 });
      const { history } = await getSupplier({ ...ctx, supplierId: supplier.id });
      expect(history[0]!.text).toBe('Editado: nome (de Som Alfa para Som Alfa Ltda; atualizado em 2 itens de orçamento e 1 lançamento), telefone.');
    });

    it("editar sem mudar o nome não mexe nos registros ligados", async () => {
      const { ctx, event } = await setup();
      const supplier = await add(ctx, { name: "Som Alfa" });
      await createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id }) });

      await updateSupplier({ ...ctx, supplierId: supplier.id, input: updateInput(1, { name: "Som Alfa", phone: "(31) 3000-0000" }) });

      const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: supplier.id, action: "SUPPLIER_UPDATED" } });
      expect(audit.metadata).toMatchObject({ renamedBudgetItems: 0, renamedExpenses: 0 });
    });
  });

  describe("quanto se gastou e se orçou com cada fornecedor", () => {
    it("o gasto por evento (só lançamentos ativos) e o orçado por oportunidade, com os totais somando os grupos", async () => {
      const { company, ctx, event } = await setup();
      const second = await createTestEvent(prisma, company.id);
      const supplier = await add(ctx, { name: "Som Alfa" });
      const other = await add(ctx, { name: "Outro" });
      await createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id, amountCents: 400_000 }) });
      await createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id, amountCents: 100_000 }) });
      await createExpense({ ...ctx, eventId: second.id, input: expenseInput({ supplierId: supplier.id, amountCents: 50_000 }) });
      await createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: other.id, amountCents: 999_999 }) });
      const voided = await createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id, amountCents: 777_777 }) });
      const { voidExpense } = await import("@/server/finance/finance.service");
      await voidExpense({ ...ctx, expenseId: voided.id, input: { reason: "Errado", baseVersion: 1 } as never });
      const opp = await opportunityFor(ctx);
      await saveBudget({ ...ctx, opportunityId: opp.id, input: budgetInput([budgetItem({ supplierId: supplier.id, quantity: 2, unitCostCents: 300_000 }), budgetItem({ description: "Outro item", supplierId: supplier.id, quantity: 1, unitCostCents: 10_000 }), budgetItem({ description: "De outro", supplierId: other.id })]) });

      const spend = await getSupplierSpend({ ...ctx, supplierId: supplier.id });

      expect(spend.realized.map((g) => [g.id, g.totalCents, g.count])).toEqual([[event.id, 500_000, 2], [second.id, 50_000, 1]]);
      expect(spend.planned.map((g) => [g.id, g.name === opp.title, g.totalCents, g.count])).toEqual([[opp.id, true, 610_000, 2]]);
      expect(spend.summary).toEqual({ realizedTotalCents: 550_000, realizedCount: 3, plannedTotalCents: 610_000, plannedCount: 2, overPlanned: false });
    });

    it("gastou mais do que orçou COM este fornecedor: avisa", async () => {
      const { ctx, event } = await setup();
      const supplier = await add(ctx);
      const opp = await opportunityFor(ctx);
      await saveBudget({ ...ctx, opportunityId: opp.id, input: budgetInput([budgetItem({ supplierId: supplier.id, quantity: 1, unitCostCents: 100_000 })]) });
      await createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id, amountCents: 100_001 }) });

      expect((await getSupplierSpend({ ...ctx, supplierId: supplier.id })).summary).toMatchObject({ overPlanned: true });
    });

    it("sem nenhum vínculo: nada gasto, nada orçado, e sem aviso", async () => {
      const { ctx } = await setup();
      const supplier = await add(ctx);

      expect(await getSupplierSpend({ ...ctx, supplierId: supplier.id })).toMatchObject({
        realized: [],
        planned: [],
        summary: { realizedTotalCents: 0, plannedTotalCents: 0, overPlanned: false },
      });
    });
  });

  describe("o orçamento e o financeiro continuam legíveis depois de arquivar", () => {
    it("o orçamento arquivado segue mostrando o nome e a oportunidade não perde o histórico", async () => {
      const { ctx } = await setup();
      const opp = await opportunityFor(ctx);
      const supplier = await add(ctx, { name: "Antigo parceiro" });
      await saveBudget({ ...ctx, opportunityId: opp.id, input: budgetInput([budgetItem({ supplierId: supplier.id })]) });
      await setSupplierArchived({ ...ctx, supplierId: supplier.id, archived: true, baseVersion: 1 });

      const view = await getBudget({ ...ctx, opportunityId: opp.id });
      const { history } = await getOpportunity({ ...ctx, opportunityId: opp.id });

      expect(view.budget!.items[0]).toMatchObject({ supplierId: supplier.id, supplier: "Antigo parceiro" });
      expect(history.map((h) => h.text)).toEqual(expect.arrayContaining([expect.stringContaining("Orçamento criado")]));
    });
  });

  describe("concorrência", () => {
    const ROUNDS = 8;

    it("dois cadastros do mesmo documento ao mesmo tempo: um só entra, o outro recebe 409 explicado", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx } = await setup();

        const results = await Promise.allSettled([add(ctx, { name: "A", document: CNPJ }), add(ctx, { name: "B", document: CNPJ }), add(ctx, { name: "C", document: CNPJ })]);

        expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
        for (const r of results.filter((r) => r.status === "rejected")) {
          expect(r.reason).toMatchObject({ status: 409, message: expect.stringContaining("já está cadastrado") });
        }
        expect(await prisma.supplier.count(), `rodada ${round}`).toBe(1);
      }
    });

    it("duas edições da mesma versão ao mesmo tempo: só uma vale, inteira", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx } = await setup();
        const created = await add(ctx);

        const results = await Promise.allSettled([
          updateSupplier({ ...ctx, supplierId: created.id, input: updateInput(1, { name: "Edição A", phone: "111" }) }),
          updateSupplier({ ...ctx, supplierId: created.id, input: updateInput(1, { name: "Edição B", phone: "222" }) }),
        ]);

        expect(results.filter((r) => r.status === "fulfilled"), `rodada ${round}`).toHaveLength(1);
        const stored = await prisma.supplier.findFirstOrThrow();
        expect(stored.version, `rodada ${round}`).toBe(2);
        expect([`Edição A/111`, `Edição B/222`], `rodada ${round}`).toContain(`${stored.name}/${stored.phone}`);
      }
    });

    it("arquivar × vincular, de forma DETERMINÍSTICA: quem vincula depois de o arquivamento travar a linha espera e é recusado (nunca vira vínculo novo com arquivado)", async () => {
      const { ctx, event } = await setup();
      const supplier = await add(ctx, { name: "Vai arquivar" });

      // Uma transação de arquivamento que segura a trava por um tempo (como se o arquivamento demorasse).
      const archiver = prisma.$transaction(
        async (tx) => {
          await lockSupplier(tx, supplier.id);
          await tx.supplier.update({ where: { id: supplier.id }, data: { archivedAt: new Date(), version: { increment: 1 } } });
          await sleep(500);
        },
        { timeout: 20_000 }
      );
      await sleep(150);
      const link = createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id }) }).then(
        () => "vinculou",
        (err: unknown) => err
      );
      await archiver;

      const outcome = await link;
      expect(outcome).toMatchObject({ name: "AdminActionError", status: 409, message: expect.stringContaining("arquivado") });
      expect(await prisma.eventExpense.count()).toBe(0);
    });

    it("arquivar × vincular em corrida livre: nunca sobra um lançamento novo ligado a um fornecedor que já estava arquivado", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx, event } = await setup();
        const supplier = await add(ctx);

        const [, link] = await Promise.allSettled([
          setSupplierArchived({ ...ctx, supplierId: supplier.id, archived: true, baseVersion: 1 }),
          createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id }) }),
        ]);

        const stored = await prisma.supplier.findFirstOrThrow();
        const expenses = await prisma.eventExpense.count();
        expect(stored.archivedAt, `rodada ${round}`).not.toBeNull();
        // Ou o vínculo entrou ANTES do arquivamento (e existe), ou foi recusado por arquivado (e não existe) — nunca um sem o outro.
        expect(link.status === "fulfilled" ? expenses === 1 : expenses === 0, `rodada ${round}`).toBe(true);
        if (link.status === "rejected") expect(link.reason).toMatchObject({ status: 409 });
      }
    });

    it("renomear × lançar com o fornecedor ao mesmo tempo: todo lançamento ligado termina com o nome ATUAL", async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await truncateAll(prisma);
        const { ctx, event } = await setup();
        const supplier = await add(ctx, { name: "Nome antigo" });

        await Promise.allSettled([
          updateSupplier({ ...ctx, supplierId: supplier.id, input: updateInput(1, { name: "Nome novo" }) }),
          createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id, description: "L1" }) }),
          createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id, description: "L2" }) }),
          createExpense({ ...ctx, eventId: event.id, input: expenseInput({ supplierId: supplier.id, description: "L3" }) }),
        ]);

        const current = (await prisma.supplier.findFirstOrThrow()).name;
        const expenses = await prisma.eventExpense.findMany();
        expect(expenses.length, `rodada ${round}`).toBeGreaterThan(0);
        expect(current, `rodada ${round}`).toBe("Nome novo");
        expect(expenses.map((e) => e.supplier), `rodada ${round}`).toEqual(expenses.map(() => "Nome novo"));
      }
    });
  });
});
