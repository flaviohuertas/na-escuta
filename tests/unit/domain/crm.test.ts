import { describe, expect, it } from "vitest";
import {
  OPEN_STAGES,
  OPPORTUNITY_STAGES,
  allowedMoves,
  centsToInput,
  describeOpportunityHistory,
  explainBlockedMove,
  formatBRL,
  formatDateBR,
  formatDocument,
  isOpenStage,
  isValidCnpj,
  isValidCpf,
  isValidDocument,
  onlyDigits,
  parseBRLToCents,
  type OpportunityStageName,
} from "@/lib/domain/crm";

describe("funil — quais movimentos são permitidos", () => {
  const blocked = (from: string, to: string, hasEvent = false) => explainBlockedMove(from, to, { hasEvent });

  it("entre as etapas em andamento é livre, para frente e para trás", () => {
    for (const from of OPEN_STAGES) {
      for (const to of OPEN_STAGES) {
        if (from !== to) expect(blocked(from, to), `${from} → ${to}`).toBeNull();
      }
    }
  });

  it("de qualquer etapa em andamento pode ganhar ou perder", () => {
    for (const from of OPEN_STAGES) {
      expect(blocked(from, "WON"), from).toBeNull();
      expect(blocked(from, "LOST"), from).toBeNull();
    }
  });

  it("de ganho ou perdido pode REABRIR em qualquer etapa em andamento", () => {
    for (const from of ["WON", "LOST"]) {
      for (const to of OPEN_STAGES) expect(blocked(from, to), `${from} → ${to}`).toBeNull();
    }
  });

  it("ganho ↔ perdido direto não: reabra antes, para o histórico dizer o que aconteceu", () => {
    expect(blocked("WON", "LOST")).toMatch(/Reabra a oportunidade/);
    expect(blocked("LOST", "WON")).toMatch(/Reabra a oportunidade/);
  });

  it("para a mesma etapa não move", () => {
    for (const stage of OPPORTUNITY_STAGES) expect(blocked(stage, stage), stage).toBe("A oportunidade já está nesta etapa.");
  });

  it("depois de virar EVENTO: não perde nem reabre (o evento existe); o resto do funil não a alcança", () => {
    expect(blocked("WON", "LOST", true)).not.toBeNull();
    for (const to of OPEN_STAGES) expect(blocked("WON", to, true), to).toMatch(/já virou um evento/);
    // Uma oportunidade em andamento com evento não deveria existir, mas se existir, também não pode ser perdida.
    expect(blocked("NEGOTIATION", "LOST", true)).toMatch(/já virou um evento/);
  });

  it("etapa desconhecida é recusada (falha fechado)", () => {
    expect(blocked("NEW", "ARQUIVADA")).toBe("Etapa desconhecida.");
    expect(blocked("NEW", "")).toBe("Etapa desconhecida.");
  });

  it("allowedMoves devolve exatamente o que explainBlockedMove libera, na ordem do funil", () => {
    expect(allowedMoves("NEW", { hasEvent: false })).toEqual(["CONTACTED", "PROPOSAL_SENT", "NEGOTIATION", "WON", "LOST"]);
    expect(allowedMoves("WON", { hasEvent: false })).toEqual(["NEW", "CONTACTED", "PROPOSAL_SENT", "NEGOTIATION"]);
    expect(allowedMoves("WON", { hasEvent: true })).toEqual([]);
    expect(allowedMoves("LOST", { hasEvent: false })).toEqual(["NEW", "CONTACTED", "PROPOSAL_SENT", "NEGOTIATION"]);
    for (const from of OPPORTUNITY_STAGES) {
      for (const hasEvent of [false, true]) {
        const allowed = allowedMoves(from, { hasEvent });
        for (const to of OPPORTUNITY_STAGES) {
          expect(allowed.includes(to), `${from} → ${to} (evento: ${hasEvent})`).toBe(explainBlockedMove(from, to, { hasEvent }) === null);
        }
      }
    }
  });

  it("isOpenStage: só as quatro primeiras", () => {
    expect(OPPORTUNITY_STAGES.filter(isOpenStage)).toEqual([...OPEN_STAGES]);
    expect(isOpenStage("WON")).toBe(false);
    expect(isOpenStage("")).toBe(false);
  });
});

describe("CPF e CNPJ", () => {
  it("aceita documentos com os dígitos verificadores certos", () => {
    for (const cpf of ["52998224725", "11144477735"]) expect(isValidCpf(cpf), cpf).toBe(true);
    for (const cnpj of ["11222333000181", "06990590000123"]) expect(isValidCnpj(cnpj), cnpj).toBe(true);
  });

  it("recusa dígito verificador errado (o erro de digitação mais comum)", () => {
    expect(isValidCpf("52998224726")).toBe(false);
    expect(isValidCpf("52998224715")).toBe(false);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("11222333000191")).toBe(false);
  });

  it("recusa sequência de dígitos iguais, tamanho errado e não-dígitos", () => {
    for (const same of ["00000000000", "11111111111", "99999999999"]) expect(isValidCpf(same), same).toBe(false);
    for (const same of ["00000000000000", "11111111111111"]) expect(isValidCnpj(same), same).toBe(false);
    expect(isValidCpf("5299822472")).toBe(false);
    expect(isValidCpf("529982247255")).toBe(false);
    expect(isValidCpf("5299822472a")).toBe(false);
    expect(isValidCnpj("1122233300018")).toBe(false);
  });

  it("isValidDocument escolhe pelo tamanho: 11 = CPF, 14 = CNPJ, o resto não é documento", () => {
    expect(isValidDocument("52998224725")).toBe(true);
    expect(isValidDocument("11222333000181")).toBe(true);
    expect(isValidDocument("123456789")).toBe(false);
    expect(isValidDocument("")).toBe(false);
    // Um CNPJ válido NÃO vale como CPF, e vice-versa.
    expect(isValidCpf("11222333000181")).toBe(false);
    expect(isValidCnpj("52998224725")).toBe(false);
  });

  it("onlyDigits tira a máscara; formatDocument põe", () => {
    expect(onlyDigits("529.982.247-25")).toBe("52998224725");
    expect(onlyDigits("11.222.333/0001-81")).toBe("11222333000181");
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatDocument("123")).toBe("123");
    expect(formatDocument(null)).toBe("");
    expect(formatDocument(undefined)).toBe("");
  });
});

describe("dinheiro — em centavos, nunca ponto flutuante", () => {
  it("lê o que a pessoa digita em pt-BR", () => {
    expect(parseBRLToCents("15.000,00")).toBe(1_500_000);
    expect(parseBRLToCents("15000")).toBe(1_500_000);
    expect(parseBRLToCents("1500,5")).toBe(150_050);
    expect(parseBRLToCents("0,99")).toBe(99);
    expect(parseBRLToCents("R$ 1.234,56")).toBe(123_456);
    expect(parseBRLToCents("  2.500  ")).toBe(250_000);
    expect(parseBRLToCents("0")).toBe(0);
  });

  it("na DÚVIDA recusa em vez de adivinhar dinheiro", () => {
    for (const text of ["1.5", "1.50", "15,000.00", "1,234,56", "abc", "", "-100", "12,345", "1..000", "1 000", "R$", "10,"]) {
      expect(parseBRLToCents(text), JSON.stringify(text)).toBeNull();
    }
  });

  it("os centavos não sofrem de erro de ponto flutuante (0,10 + 0,20 fica exato)", () => {
    expect(parseBRLToCents("0,10")! + parseBRLToCents("0,20")!).toBe(30);
    expect(parseBRLToCents("19,99")).toBe(1999);
    expect(parseBRLToCents("1.000.000,01")).toBe(100_000_001);
  });

  it("centsToInput é o inverso, com milhar e duas casas", () => {
    expect(centsToInput(1_500_000)).toBe("15.000,00");
    expect(centsToInput(5)).toBe("0,05");
    expect(centsToInput(100_000_001)).toBe("1.000.000,01");
    expect(centsToInput(null)).toBe("");
    for (const cents of [0, 1, 99, 100, 123_456, 2_000_000_000]) {
      expect(parseBRLToCents(centsToInput(cents)), String(cents)).toBe(cents);
    }
  });

  it("formatBRL mostra em reais", () => {
    expect(formatBRL(1_500_000)).toMatch(/R\$\s?15\.000,00/);
    expect(formatBRL(0)).toMatch(/R\$\s?0,00/);
  });
});

describe("formatDateBR", () => {
  it("mostra a data no horário de Brasília, o mesmo no servidor e no navegador", () => {
    expect(formatDateBR("2027-01-10T15:00:00.000Z")).toBe("10/01/2027");
    // 02:00Z ainda é o dia anterior em Brasília (UTC-3), qualquer que seja o fuso de quem roda o teste.
    expect(formatDateBR("2027-01-10T02:00:00.000Z")).toBe("09/01/2027");
    expect(formatDateBR(new Date("2027-01-10T15:00:00.000Z"))).toBe("10/01/2027");
  });

  it("vazio ou inválido vira travessão, sem estourar", () => {
    expect(formatDateBR(null)).toBe("—");
    expect(formatDateBR(undefined)).toBe("—");
    expect(formatDateBR("não é data")).toBe("—");
  });
});

describe("describeOpportunityHistory — o histórico em palavras", () => {
  it("criada e virou evento", () => {
    expect(describeOpportunityHistory("OPPORTUNITY_CREATED", null, { stage: "NEW" })).toBe("Oportunidade criada.");
    expect(describeOpportunityHistory("OPPORTUNITY_CONVERTED", {}, {})).toBe("Virou um evento.");
  });

  it("mudança de etapa diz de onde e para onde, e o motivo da perda", () => {
    expect(describeOpportunityHistory("OPPORTUNITY_STAGE_CHANGED", { stage: "NEGOTIATION" }, { stage: "WON" })).toBe("Etapa: Negociação → Ganho");
    expect(describeOpportunityHistory("OPPORTUNITY_STAGE_CHANGED", { stage: "NEW" }, { stage: "LOST", lostReason: "Foi para a concorrência" })).toBe(
      "Etapa: Novo → Perdido — motivo: Foi para a concorrência"
    );
    expect(describeOpportunityHistory("OPPORTUNITY_STAGE_CHANGED", { stage: "LOST", lostReason: "x" }, { stage: "NEW", lostReason: null })).toBe("Etapa: Perdido → Novo");
  });

  it("edição lista SÓ o que mudou, com o nome do campo em palavras", () => {
    const before = { title: "A", description: null, expectedValueCents: 100, expectedStartDate: null, expectedEndDate: null, ownerUserId: "u1" };
    expect(describeOpportunityHistory("OPPORTUNITY_UPDATED", before, { ...before, title: "B" })).toBe("Editada: título.");
    expect(describeOpportunityHistory("OPPORTUNITY_UPDATED", before, { ...before, expectedValueCents: 200, ownerUserId: "u2" })).toBe("Editada: valor estimado, responsável.");
    expect(describeOpportunityHistory("OPPORTUNITY_UPDATED", before, { ...before })).toBe("Dados da oportunidade editados.");
  });

  it("ação desconhecida sai como veio (nunca some) e etapa desconhecida não estoura", () => {
    expect(describeOpportunityHistory("OUTRA_COISA", null, null)).toBe("OUTRA_COISA");
    expect(describeOpportunityHistory("OPPORTUNITY_STAGE_CHANGED", { stage: "ANTIGA" }, { stage: "NEW" })).toBe("Etapa: ANTIGA → Novo");
    expect(describeOpportunityHistory("OPPORTUNITY_STAGE_CHANGED", undefined, undefined)).toBe("Etapa: — → —");
  });

  it("cada etapa do funil tem rótulo em português (nenhum código cru na tela)", () => {
    for (const stage of OPPORTUNITY_STAGES as readonly OpportunityStageName[]) {
      const text = describeOpportunityHistory("OPPORTUNITY_STAGE_CHANGED", { stage: "NEW" }, { stage });
      expect(text, stage).not.toMatch(/[A-Z]{3,}_?[A-Z]*$/);
    }
  });
});
