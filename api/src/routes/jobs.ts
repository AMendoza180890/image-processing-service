import type { FastifyInstance } from "fastify";
import { JobStatus, listJobsQuerySchema, jobIdParamsSchema } from "@app/types";
import type { JobsRepository } from "../repositories/jobs.js";
import type { ObjectStorage } from "../storage.js";
import type { JobQueue } from "../queue.js";

export interface JobRoutesDeps {
  repo: JobsRepository;
  storage: ObjectStorage;
  queue: JobQueue;
  presignExpiresSeconds: number;
  /** Tipos MIME aceptados en la subida. */
  acceptedMimeTypes: readonly string[];
}

export function registerJobRoutes(app: FastifyInstance, deps: JobRoutesDeps): void {
  const { repo, storage, queue, presignExpiresSeconds, acceptedMimeTypes } = deps;

  // POST /jobs — multipart/form-data con el archivo `file`.
  // Flujo: crea registro pending → sube original a S3 → publica {jobId} en SQS.
  app.post("/jobs", async (request, reply) => {
    // Errores de @fastify/multipart (content-type no multipart, límites, etc.) traen su
    // propio statusCode; Fastify los responde tal cual al relanzarlos.
    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: "Bad Request", details: "Falta el archivo `file`" });
    }
    if (!data.filename || data.filename.trim() === "") {
      return reply.status(400).send({ error: "Bad Request", details: "Nombre de archivo vacío" });
    }
    if (!acceptedMimeTypes.includes(data.mimetype)) {
      return reply
        .status(415)
        .send({ error: "Unsupported Media Type", details: `MIME no permitido: ${data.mimetype}` });
    }

    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (err) {
      // toBuffer() lanza FST_REQ_FILE_TOO_LARGE si se supera `limits.fileSize`.
      if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.status(413).send({ error: "Payload Too Large" });
      }
      throw err;
    }

    const job = await repo.create({ originalFilename: data.filename });
    try {
      await storage.putObject(job.s3KeyOriginal, buffer, data.mimetype);
      await queue.publishJob({ jobId: job.id });
    } catch (err) {
      // Nadie va a procesar este job: se marca `error` para que no quede `pending` para siempre.
      await repo
        .markError(job.id, "No se pudo encolar la imagen para procesarla")
        .catch((markErr: unknown) =>
          request.log.error({ err: markErr, jobId: job.id }, "No se pudo marcar el job como error"),
        );
      throw err;
    }

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

  // GET /jobs/:id/download — URL prefirmada del resultado (solo si el job está `done`).
  app.get("/jobs/:id/download", async (request, reply) => {
    const parsed = jobIdParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Bad Request", details: parsed.error.issues });
    }
    const job = await repo.findById(parsed.data.id);
    if (!job) {
      return reply.status(404).send({ error: "Not Found" });
    }
    if (job.status !== JobStatus.Done || !job.s3KeyResult) {
      return reply
        .status(409)
        .send({ error: "Conflict", details: `El job no está listo (estado: ${job.status})` });
    }
    const url = await storage.getSignedDownloadUrl(
      job.s3KeyResult,
      presignExpiresSeconds,
      resultFilename(job.originalFilename),
    );
    return reply.send({ url, expiresInSeconds: presignExpiresSeconds });
  });
}

/** Nombre con el que se descarga el resultado (el worker siempre produce PNG). */
export function resultFilename(originalFilename: string): string {
  const base = originalFilename.replace(/\.[^.]*$/, "") || "imagen";
  return `${base}-procesado.png`;
}
