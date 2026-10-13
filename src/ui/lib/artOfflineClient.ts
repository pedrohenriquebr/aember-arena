/**
 * Cliente do cache de arte do SW (ART_OFFLINE): fala com o public/sw.js por postMessage.
 * Sem service worker ativo (dev, primeira carga, navegador sem SW) cada chamada devolve
 * null/false — a UI mostra "indisponível" em vez de travar.
 */

/** Progresso que o SW transmite (broadcast a todas as janelas) durante um warm. */
export interface ArtProgress {
  key: string;
  done: number;
  failed: number;
  total: number;
}

/** Sem progresso por este tempo o warm é dado como encerrado (SW encerrado no meio). */
const STALL_MS = 45_000;
const REPLY_MS = 4_000;

async function activeWorker(): Promise<ServiceWorker | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  // getRegistration (e não .ready): em dev não há SW e o ready nunca resolveria.
  const registration = await navigator.serviceWorker.getRegistration();
  return registration?.active ?? null;
}

function ask<T>(worker: ServiceWorker, message: Record<string, unknown>): Promise<T | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), REPLY_MS);
    channel.port1.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      resolve(event.data as T);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

/** Há um SW ativo que aceita o cache de arte? */
export async function artWorkerAvailable(): Promise<boolean> {
  return (await activeWorker()) !== null;
}

/** Quais URLs já estão no cache de arte (sem tocar a ordem LRU). null = sem SW. */
export async function checkArt(urls: string[]): Promise<boolean[] | null> {
  if (urls.length === 0) return [];
  const worker = await activeWorker();
  if (!worker) return null;
  const reply = await ask<{ present: boolean[] }>(worker, { type: "check-art", urls });
  return reply?.present ?? null;
}

/**
 * Pede ao SW que guarde as artes do deck. `onProgress` recebe cada avanço; a promessa
 * resolve true quando todas as URLs foram tratadas, false se não há SW ou o progresso parou.
 */
export async function warmArt(key: string, urls: string[], onProgress: (progress: ArtProgress) => void): Promise<boolean> {
  const worker = await activeWorker();
  if (!worker) return false;
  // Pedido só quando o primeiro warm acontece: a quota de arte é o que a origem mais ocupa.
  void navigator.storage?.persist?.();
  return new Promise((resolve) => {
    let stall: ReturnType<typeof setTimeout>;
    const finish = (ok: boolean) => {
      clearTimeout(stall);
      navigator.serviceWorker.removeEventListener("message", listener);
      resolve(ok);
    };
    const arm = () => {
      clearTimeout(stall);
      stall = setTimeout(() => finish(false), STALL_MS);
    };
    const listener = (event: MessageEvent) => {
      const progress = event.data as ({ type?: string } & ArtProgress) | undefined;
      if (!progress || progress.type !== "art-progress" || progress.key !== key) return;
      onProgress(progress);
      if (progress.done >= progress.total) finish(true);
      else arm();
    };
    navigator.serviceWorker.addEventListener("message", listener);
    arm();
    worker.postMessage({ type: "warm-art", key, urls });
  });
}

/** Apaga todo o cache de arte. false = sem SW ou sem resposta. */
export async function clearArt(): Promise<boolean> {
  const worker = await activeWorker();
  if (!worker) return false;
  const reply = await ask<{ ok: boolean }>(worker, { type: "clear-art" });
  return reply?.ok === true;
}

/** Uso/quota do origin (o contador já inclui o preenchimento das opacas). */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  const estimate = await navigator.storage?.estimate?.();
  if (!estimate || estimate.usage === undefined || estimate.quota === undefined) return null;
  return { usage: estimate.usage, quota: estimate.quota };
}
