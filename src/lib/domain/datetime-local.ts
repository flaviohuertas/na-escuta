/**
 * Ponte entre o `<input type="datetime-local">` (texto "2026-09-19T14:30", em horário LOCAL, sem
 * fuso) e o ISO com fuso que o servidor guarda ("2026-09-19T17:30:00.000Z"). A conversão usa o
 * fuso do aparelho de quem está preenchendo — o horário que a pessoa digita é o horário que ela
 * vê depois, em qualquer fuso.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO → valor para o input (minuto de precisão). Data inválida → string vazia. */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Valor do input → ISO. Vazio ou inválido → `null` (o formulário mostra "informe a data"). */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value); // sem fuso no texto ⇒ interpretado como horário local
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
