import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { Db } from "./db.js";
import { PgJobsRepository, type JobsRepository } from "./repositories/jobs.js";
import { registerJobRoutes } from "./routes/jobs.js";

export interface BuildAppOptions {
  db: Db;
  corsOrigin?: string;
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

  registerJobRoutes(app, repo);

  return app;
}
