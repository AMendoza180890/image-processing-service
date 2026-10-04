import { JobStatus } from "@app/types";
import type { WorkerJobsRepository } from "./repository.js";
import type { ObjectStorage } from "./storage.js";
import { processImage, type ProcessOptions } from "./processor.js";

export interface HandleJobDeps {
  repo: WorkerJobsRepository;
  storage: ObjectStorage;
  process: ProcessOptions;
  logger?: Pick<typeof console, "info" | "error">;
}

/** Clave S3 del resultado de un job. */
export function resultKeyFor(jobId: string): string {
  return `results/${jobId}`;
}

/**
 * Procesa un job de forma idempotente: descarga el original, genera el resultado,
 * lo sube y marca `done`. Si algo falla, marca `error` con el mensaje.
 *
 * Idempotencia: si el job ya está `done` (redelivery de SQS), no reprocesa.
 * Devuelve `true` si el mensaje debe borrarse de la cola (terminó, ok o error terminal).
 */
export async function handleJob(jobId: string, deps: HandleJobDeps): Promise<boolean> {
  const { repo, storage, process: processOpts } = deps;
  const log = deps.logger ?? console;

  const job = await repo.findById(jobId);
  if (!job) {
    // El job no existe: nada que procesar, borramos el mensaje para no reintentar.
    log.error(`Job inexistente, se descarta el mensaje: ${jobId}`);
    return true;
  }
  if (job.status === JobStatus.Done) {
    log.info(`Job ya procesado (idempotente): ${jobId}`);
    return true;
  }

  await repo.markProcessing(jobId);
  try {
    const original = await storage.getObject(job.s3KeyOriginal);
    const { body, contentType } = await processImage(original, processOpts);
    const key = resultKeyFor(jobId);
    await storage.putObject(key, body, contentType);
    await repo.markDone(jobId, key);
    log.info(`Job procesado: ${jobId} -> ${key}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await repo.markError(jobId, message);
    log.error(`Job en error: ${jobId} (${message})`);
    // Error terminal: se registró en la DB, borramos el mensaje (DLQ conceptual).
    return true;
  }
}
