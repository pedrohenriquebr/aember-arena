/**
 * Artes offline por deck (ART_OFFLINE, fase 1). Lógica pura: o estado de cada deck, o
 * custo que o navegador cobra e a formatação do aviso. O cliente (postMessage ao SW)
 * mora em artOfflineClient.ts.
 */
import { localizedArtUrl } from "../../lib/artLocale";

/** Quota que o navegador cobra por arte opaca (medida: ~7 MB, sem relação com o tamanho real). */
export const ART_QUOTA_COST_BYTES = 7 * 1024 * 1024;
/** Tamanho real médio de uma arte no S3 (medido: ~150 KB) — só para o aviso. */
export const ART_REAL_BYTES = 150 * 1024;

export type ArtStatus = "none" | "partial" | "full";

/** URLs de arte de um deck, sem repetição (o mesmo card pode estar 3x no deck), no
    idioma da UI — o cache guarda o que a tela mostra (render PT quando houver). */
export function artUrlsOf(cards: ReadonlyArray<{ image?: string }>): string[] {
  return [...new Set(cards.map((card) => localizedArtUrl(card.image ?? "")).filter((url) => url.startsWith("https://")))];
}

/** Estado do deck a partir de quais das suas URLs já estão no cache do SW. */
export function artStatusOf(present: readonly boolean[]): ArtStatus {
  const have = present.filter(Boolean).length;
  if (have === 0) return "none";
  return have === present.length ? "full" : "partial";
}

/** Quota que N artes ocupam no contador do navegador (estimativa: N × custo opaco). */
export function estimateArtQuota(count: number): number {
  return Math.max(0, Math.floor(count)) * ART_QUOTA_COST_BYTES;
}

/** Bytes em MB/KB no idioma do app. Só para exibição; nunca entra em conta. */
export function formatBytes(bytes: number, locale: string): string {
  const mb = 1024 * 1024;
  if (bytes >= mb) return `${(bytes / mb).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`;
  return `${Math.round(bytes / 1024).toLocaleString(locale)} KB`;
}
