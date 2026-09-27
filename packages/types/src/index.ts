import { z } from "zod";

/**
 * Estados posibles de un Job de procesamiento de imagen.
 * El worker mueve el job: pending -> processing -> done | error.
 */
export enum JobStatus {
  Pending = "pending",
  Processing = "processing",
  Done = "done",
  Error = "error",
}

/** Schema runtime del enum de estados (reutilizable por API/DB). */
export const jobStatusSchema = z.nativeEnum(JobStatus);

/**
 * Representación de un Job tal como lo expone la API (JSON).
 * Las fechas viajan como ISO strings.
 */
export const jobSchema = z.object({
  id: z.string().uuid(),
  originalFilename: z.string().min(1),
  s3KeyOriginal: z.string().min(1),
  s3KeyResult: z.string().nullable(),
  status: jobStatusSchema,
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Job = z.infer<typeof jobSchema>;

/** Respuesta de POST /jobs. */
export const createJobResponseSchema = z.object({
  job: jobSchema,
});
export type CreateJobResponse = z.infer<typeof createJobResponseSchema>;

/** Query params de GET /jobs (paginación simple). */
export const listJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListJobsQuery = z.infer<typeof listJobsQuerySchema>;

/** Respuesta de GET /jobs. */
export const jobListResponseSchema = z.object({
  jobs: z.array(jobSchema),
  total: z.number().int().min(0),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type JobListResponse = z.infer<typeof jobListResponseSchema>;

/** Params `:id` de las rutas de detalle. */
export const jobIdParamsSchema = z.object({
  id: z.string().uuid(),
});
export type JobIdParams = z.infer<typeof jobIdParamsSchema>;

/** Respuesta de GET /jobs/:id/download (Fase 2). */
export const presignedUrlResponseSchema = z.object({
  url: z.string().url(),
  expiresInSeconds: z.number().int().positive(),
});
export type PresignedUrlResponse = z.infer<typeof presignedUrlResponseSchema>;

/** Mensaje publicado en SQS por la API y consumido por el worker (Fase 2). */
export const jobMessageSchema = z.object({
  jobId: z.string().uuid(),
});
export type JobMessage = z.infer<typeof jobMessageSchema>;
