import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ACCEPTED_IMAGE_MIME_TYPES } from "@app/types";
import type { Db } from "./db.js";
import { PgJobsRepository, type JobsRepository } from "./repositories/jobs.js";
import type { ObjectStorage } from "./storage.js";
import type { JobQueue } from "./queue.js";
import { registerJobRoutes } from "./routes/jobs.js";

export interface BuildAppOptions {
  db: Db;
  storage: ObjectStorage;
  queue: JobQueue;
  corsOrigin?: string;
  presignExpiresSeconds?: number;
  maxUploadBytes?: number;
  /** Permite inyectar un repositorio (mock) en tests de rutas. */
  repo?: JobsRepository;
}

/**
 * Construye la instancia de Fastify con rutas y healthcheck.
 * No hace listen(): eso queda en server.ts, así los tests pueden usar app.inject().
 */
export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: opts.corsOrigin ?? "*" });
  await app.register(multipart, {
    limits: { files: 1, fileSize: opts.maxUploadBytes ?? 10 * 1024 * 1024 },
  });

  const repo = opts.repo ?? new PgJobsRepository(opts.db);

  // Healthcheck: valida conectividad con la DB (usado por Docker/compose).
  app.get("/health", async (_request, reply) => {
    try {
      await opts.db.query("SELECT 1");
      return reply.send({ status: "ok" });
    } catch {
      return reply.status(503).send({ status: "unhealthy" });
    }
  });

  registerJobRoutes(app, {
    repo,
    storage: opts.storage,
    queue: opts.queue,
    presignExpiresSeconds: opts.presignExpiresSeconds ?? 900,
    acceptedMimeTypes: ACCEPTED_IMAGE_MIME_TYPES,
  });

  return app;
}
