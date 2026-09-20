import { z } from "zod";
import type { AppDatabase } from "@/lib/db/dexie/schema";
import { clearUserScopedCaches } from "@/lib/offline/warm-routes";
import { purgeDeviceData } from "@/lib/sync/device-revocation";

/**
 * `no-grant`: o aparelho não tem grant guardado (nunca entrou, ou já foi limpo) — nada a perguntar.
 * `valid`: o servidor confirmou que continua valendo.
 * `revoked`: o servidor disse que perdeu o acesso e o aparelho SE LIMPOU.
 * `unknown`: não foi possível saber (rede, servidor fora, resposta estranha, grant que o servidor
 * não reconhece). NUNCA apaga nada.
 */
export type DeviceCheckOutcome = "no-grant" | "valid" | "revoked" | "unknown";

const VerdictSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("valid") }),
  z.object({ status: z.literal("revoked"), reason: z.string().nullable().optional() }),
]);

/**
 * Pergunta ao servidor, SEM sessão, se este aparelho ainda vale — apresentando o grant offline — e
 * se a resposta for "revogado", limpa o aparelho (`purgeDeviceData`).
 *
 * É o caminho de quem teve o vínculo encerrado: a sessão caiu, o login é recusado e o sync devolve
 * 401, então nada mais avisaria o aparelho.
 *
 * A regra de segurança é assimétrica de propósito: só um veredito `revoked` assinado por esta
 * rota apaga. Falha de rede, servidor fora do ar, 401/500 ou uma resposta que não entendemos
 * viram `unknown` e não tocam em nada — um erro do servidor não pode custar o trabalho de campo
 * de ninguém.
 */
export async function checkDeviceStatus(
  db: AppDatabase,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<DeviceCheckOutcome> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const grant = await db.session.get("current");
  if (!grant) return "no-grant";

  let verdict: z.infer<typeof VerdictSchema>;
  try {
    const res = await fetchImpl("/api/auth/device-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jwt: grant.jwt }),
      cache: "no-store",
    });
    if (!res.ok) return "unknown";
    const parsed = VerdictSchema.safeParse(await res.json());
    if (!parsed.success) return "unknown";
    verdict = parsed.data;
  } catch {
    return "unknown";
  }

  if (verdict.status === "valid") return "valid";

  const kept = await purgeDeviceData(db, {
    reason: verdict.reason ?? null,
    userId: grant.userId,
    // Se a pessoa entrou de novo enquanto perguntávamos, o grant guardado já é outro: o veredito é velho.
    onlyIfGrant: grant.jwt,
  });
  if (kept === null) return "unknown";

  // O HTML guardado pelo Service Worker carrega nome e dados dos eventos: sai junto.
  await clearUserScopedCaches();
  return "revoked";
}
