import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Dados fictícios para desenvolvimento local — nunca use estas credenciais
 * fora de um ambiente de dev descartável. E-mail/senha de demonstração:
 * demo@naescuta.com.br / NaEscuta#2026
 */
async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  const passwordHash = await bcrypt.hash("NaEscuta#2026", 10);

  const company = await prisma.company.upsert({
    where: { slug: "produtora-demo" },
    update: {},
    create: {
      name: "Produtora Demo (dados fictícios)",
      slug: "produtora-demo",
      offlineAccessDays: 7,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "demo@naescuta.com.br" },
    update: {},
    create: {
      email: "demo@naescuta.com.br",
      name: "Usuária Demo",
      passwordHash,
    },
  });

  await prisma.membership.upsert({
    where: { userId_companyId: { userId: user.id, companyId: company.id } },
    update: {},
    create: { userId: user.id, companyId: company.id, role: "OWNER" },
  });

  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const in31Days = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);

  const event = await prisma.event.create({
    data: {
      companyId: company.id,
      name: "Festival Na Escuta 2026 (evento fictício)",
      description: "Evento de demonstração criado pelo seed — dados fictícios.",
      location: "Parque da Cidade, São Paulo - SP",
      startDate: in30Days,
      endDate: in31Days,
      status: "CONFIRMED",
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await prisma.eventAccess.create({
    data: {
      userId: user.id,
      eventId: event.id,
      role: "MANAGER",
      grantedBy: user.id,
    },
  });

  // Segunda pessoa, com papel RESTRITO (equipe de campo): serve para ver e testar o que quem não é
  // gestor enxerga — não cria evento, não edita evento.
  const fieldUser = await prisma.user.upsert({
    where: { email: "equipe@naescuta.com.br" },
    update: {},
    create: { email: "equipe@naescuta.com.br", name: "Pessoa da Equipe (demo)", passwordHash },
  });
  await prisma.membership.upsert({
    where: { userId_companyId: { userId: fieldUser.id, companyId: company.id } },
    update: {},
    create: { userId: fieldUser.id, companyId: company.id, role: "STAFF" },
  });
  await prisma.eventAccess.create({
    data: { userId: fieldUser.id, eventId: event.id, role: "FIELD_STAFF", grantedBy: user.id },
  });

  await prisma.task.createMany({
    data: [
      {
        eventId: event.id,
        companyId: company.id,
        title: "Confirmar fornecedor de som e iluminação",
        status: "IN_PROGRESS",
        priority: 2,
        dueAt: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
        createdBy: user.id,
        updatedBy: user.id,
      },
      {
        eventId: event.id,
        companyId: company.id,
        title: "Enviar briefing de segurança para a equipe de campo",
        status: "TODO",
        priority: 1,
        dueAt: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000),
        createdBy: user.id,
        updatedBy: user.id,
      },
    ],
  });

  const checklist = await prisma.checklistTemplate.create({
    data: {
      companyId: company.id,
      eventId: event.id,
      title: "Checklist de montagem do palco principal",
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await prisma.checklistItem.createMany({
    data: [
      {
        checklistId: checklist.id,
        eventId: event.id,
        companyId: company.id,
        label: "Testar sistema de som",
        order: 1,
        isRequired: true,
        createdBy: user.id,
        updatedBy: user.id,
      },
      {
        checklistId: checklist.id,
        eventId: event.id,
        companyId: company.id,
        label: "Verificar saídas de emergência",
        order: 2,
        isRequired: true,
        createdBy: user.id,
        updatedBy: user.id,
      },
      {
        checklistId: checklist.id,
        eventId: event.id,
        companyId: company.id,
        label: "Testar gerador de energia reserva",
        order: 3,
        isRequired: false,
        createdBy: user.id,
        updatedBy: user.id,
      },
    ],
  });

  console.log("Seed concluído (dados fictícios):");
  console.log(`  Empresa: ${company.name} (${company.slug})`);
  console.log(`  Login demo (dona, gestora do evento): demo@naescuta.com.br / NaEscuta#2026`);
  console.log(`  Login equipe (papel restrito): equipe@naescuta.com.br / NaEscuta#2026`);
  console.log(`  Evento: ${event.name} (${event.id})`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Falha ao rodar o seed:", err);
  process.exit(1);
});
