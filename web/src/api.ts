import {
  createJobResponseSchema,
  jobListResponseSchema,
  jobSchema,
  presignedUrlResponseSchema,
  type Job,
  type JobListResponse,
  type PresignedUrlResponse,
} from "@app/types";
import { z, type ZodType } from "zod";

/** Error HTTP de la API, con el status y el mensaje legible para mostrar en la UI. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClient {
  listJobs(limit?: number, offset?: number): Promise<JobListResponse>;
  getJob(id: string): Promise<Job>;
  createJob(file: File): Promise<Job>;
  getDownloadUrl(id: string): Promise<PresignedUrlResponse>;
}

const errorBodySchema = z.object({ error: z.string().optional(), details: z.unknown() });

/** Mensajes para los códigos que la API devuelve en el flujo de subida/descarga. */
const STATUS_MESSAGES: Record<number, string> = {
  409: "El resultado todavía no está listo",
  413: "El archivo supera el tamaño máximo permitido",
  415: "Formato no soportado: subí una imagen PNG, JPEG, WebP o GIF",
};

async function toApiError(res: Response): Promise<ApiError> {
  let details: string | undefined;
  try {
    const body = errorBodySchema.safeParse(await res.json());
    if (body.success && typeof body.data.details === "string") details = body.data.details;
  } catch {
    // Cuerpo no JSON (ej. 502 de Nginx): nos quedamos con el status.
  }
  const message = STATUS_MESSAGES[res.status] ?? details ?? `Error ${res.status} de la API`;
  return new ApiError(res.status, message);
}

/**
 * Cliente HTTP tipado. Cada respuesta se valida con los schemas zod de `@app/types`,
 * así un cambio de contrato en la API falla aquí y no en un render.
 */
export function createApiClient(baseUrl: string, fetchImpl: typeof fetch = fetch): ApiClient {
  const base = baseUrl.replace(/\/$/, "");

  async function request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, init);
    } catch {
      throw new ApiError(0, "No se pudo conectar con la API");
    }
    if (!res.ok) throw await toApiError(res);
    return schema.parse(await res.json());
  }

  return {
    listJobs: (limit = 20, offset = 0) =>
      request(`/jobs?limit=${limit}&offset=${offset}`, jobListResponseSchema),
    getJob: async (id) => (await request(`/jobs/${id}`, z.object({ job: jobSchema }))).job,
    createJob: async (file) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return (await request("/jobs", createJobResponseSchema, { method: "POST", body: form })).job;
    },
    getDownloadUrl: (id) => request(`/jobs/${id}/download`, presignedUrlResponseSchema),
  };
}
