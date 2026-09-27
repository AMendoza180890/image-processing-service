import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listJobsQuerySchema, jobIdParamsSchema } from "@app/types";
import type { JobsRepository } from "../repositories/jobs.js";

/** Body de POST /jobs en Fase 1 (JSON). En Fase 2 pasa a multipart con el archivo. */
const createJobBodySchema = z.object({
  originalFilename: z.string().min(1).max(255),
});

export function registerJobRoutes(app: FastifyInstance, repo: JobsRepository): void {
  app.post("/jobs", async (request, reply) => {
    const parsed = createJobBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", details: parsed.error.issues });
    }
    const job = await repo.create({ originalFilename: parsed.data.originalFilename });
    return reply.status(201).send({ job });
  });

  app.get("/jobs", async (request, reply) => {
    const parsed = listJobsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", details: parsed.error.issues });
    }
    const { limit, offset } = parsed.data;
    const { jobs, total } = await repo.list(limit, offset);
    return reply.send({ jobs, total, limit, offset });
  });

  app.get("/jobs/:id", async (request, reply) => {
    const parsed = jobIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", details: parsed.error.issues });
    }
    const job = await repo.findById(parsed.data.id);
    if (!job) {
      return reply.status(404).send({ error: "Not Found" });
    }
    return reply.send({ job });
  });
}
