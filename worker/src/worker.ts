import { jobMessageSchema } from "@app/types";
import type { JobQueue } from "./queue.js";
import { handleJob, type HandleJobDeps } from "./handler.js";

export interface RunLoopOptions {
  queue: JobQueue;
  handleDeps: HandleJobDeps;
  pollWaitSeconds: number;
  /** Señal para detener el loop de forma ordenada. */
  signal: AbortSignal;
  logger?: Pick<typeof console, "info" | "error">;
  /** Espera entre reintentos cuando un ciclo falla: arranca en `initialMs` y se duplica. */
  retryBackoff?: { initialMs: number; maxMs: number };
}

const DEFAULT_BACKOFF = { initialMs: 1000, maxMs: 30_000 };

/** Espera `ms`, pero termina antes si se aborta la señal (apagado ordenado). */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

/**
 * Procesa una tanda de mensajes de la cola. Extraído del loop para poder testear
 * un ciclo aislado. Devuelve cuántos mensajes se procesaron.
 */
export async function processBatch(opts: RunLoopOptions): Promise<number> {
  const { queue, handleDeps, pollWaitSeconds } = opts;
  const log = opts.logger ?? console;

  const messages = await queue.receiveMessages(pollWaitSeconds);
  for (const message of messages) {
    let jobId: string;
    try {
      jobId = jobMessageSchema.parse(JSON.parse(message.body)).jobId;
    } catch {
      // Mensaje corrupto (poison): no se puede procesar, se descarta.
      log.error(`Mensaje inválido, se descarta: ${message.body}`);
      await queue.deleteMessage(message.receiptHandle);
      continue;
    }

    try {
      const done = await handleJob(jobId, handleDeps);
      if (done) {
        await queue.deleteMessage(message.receiptHandle);
      }
    } catch (err) {
      // Fallo transitorio (ej. DB caída): no se borra el mensaje, así SQS lo reentrega tras
      // el visibility timeout. Se sigue con el resto de la tanda.
      log.error(`Error procesando el job ${jobId}, se reintentará: ${String(err)}`);
    }
  }
  return messages.length;
}

/** Loop principal: hace long-polling hasta que se aborta la señal. */
export async function runLoop(opts: RunLoopOptions): Promise<void> {
  const log = opts.logger ?? console;
  log.info("Worker iniciado, escuchando la cola...");
  const backoff = opts.retryBackoff ?? DEFAULT_BACKOFF;
  let delayMs = backoff.initialMs;
  while (!opts.signal.aborted) {
    try {
      await processBatch(opts);
      delayMs = backoff.initialMs;
    } catch (err) {
      // Un fallo transitorio (red, SQS) no debe matar el worker, pero tampoco reintentar en
      // caliente: se espera con backoff exponencial antes del próximo ciclo.
      log.error(`Error en el ciclo del worker (reintento en ${delayMs} ms): ${String(err)}`);
      await sleep(delayMs, opts.signal);
      delayMs = Math.min(delayMs * 2, backoff.maxMs);
    }
  }
  log.info("Worker detenido.");
}
