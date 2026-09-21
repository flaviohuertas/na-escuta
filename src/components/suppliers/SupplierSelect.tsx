"use client";

import { inputClass } from "@/components/crm/Field";

export interface SupplierChoice {
  id: string;
  name: string;
  /** Arquivado: só aparece se o registro já o cita — e a tela avisa. */
  archived?: boolean;
}

/**
 * O seletor do fornecedor CADASTRADO num item de orçamento ou lançamento. Sem nenhum cadastrado não
 * aparece (a tela fica só com o texto livre, como antes). "Sem cadastro" deixa a pessoa digitar o
 * nome; escolher um do cadastro vincula pelo id e o servidor guarda o nome dele.
 */
export function SupplierSelect({
  id,
  label,
  suppliers,
  value,
  onChange,
}: {
  id?: string;
  /** O nome acessível do campo (ex.: "Fornecedor cadastrado do item 2"). */
  label: string;
  suppliers: readonly SupplierChoice[];
  value: string;
  onChange: (supplierId: string) => void;
}) {
  if (suppliers.length === 0) return null;

  return (
    <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      <option value="">Sem cadastro (digitar o nome)</option>
      {suppliers.map((supplier) => (
        <option key={supplier.id} value={supplier.id}>
          {supplier.name}
          {supplier.archived ? " (arquivado)" : ""}
        </option>
      ))}
    </select>
  );
}
