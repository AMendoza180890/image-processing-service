import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  JobStatus,
  createJobResponseSchema,
  presignedUrlResponseSchema,
  type Job,
  type JobMessage,
} from "@app/types";
import { buildApp } from "../app.js";
import { resultFilename } from "./jobs.js";
import type { JobsRepository, CreateJobInput } from "../repositories/jobs.js";
import type { ObjectStorage } from "../storage.js";
import type { JobQueue } from "../queue.js";

/** Repositorio en memoria para probar las rutas sin Postgres. */
class InMemoryJobsRepository implements JobsRepository {
  jobs: Job[] = [];
  private counter = 0;

  private nextId(): string {
    this.counter += 1;
    return `00000000-0000-0000-0000-${String(this.counter).padStart(12, "0")}`;
  }

  async create(input: CreateJobInput): Promise<Job> {
    const id = this.nextId();
    const now = new Date().toISOString();
    const job: Job = {
      id,
      originalFilename: input.originalFilename,
      s3KeyOriginal: `originals/${id}`,
      s3KeyResult: null,
      status: JobStatus.Pending,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.unshift(job);
    return job;
  }

  /** Helper de test: inserta un job ya `done` con resultado. */
  seedDone(): Job {
    const id = this.nextId();
    const now = new Date().toISOString();
    const job: Job = {
      id,
      originalFilename: "foto.png",
      s3KeyOriginal: `originals/${id}`,
      s3KeyResult: `results/${id}`,
      status: JobStatus.Done,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.unshift(job);
    return job;
  }

  async findById(id: string): Promise<Job | null> {
    return this.jobs.find((j) => j.id === id) ?? null;
  }

  async list(limit: number, offset: number): Promise<{ jobs: Job[]; total: number }> {
    return { jobs: this.jobs.slice(offset, offset + limit), total: this.jobs.length };
  }

  async markError(id: string, errorMessage: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === id);
    if (job) Object.assign(job, { status: JobStatus.Error, errorMessage });
  }
}

class FakeStorage implements ObjectStorage {
  puts: { key: string; contentType: string; size: number }[] = [];
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    this.puts.push({ key, contentType, size: body.length });
  }
  downloadFilenames: (string | undefined)[] = [];
  async getSignedDownloadUrl(
    key: string,
    expiresInSeconds: number,
    downloadFilename?: string,
  ): Promise<string> {
    this.downloadFilenames.push(downloadFilename);
    return `https://signed.example/${key}?exp=${expiresInSeconds}`;
  }
}

class FakeQueue implements JobQueue {
  published: JobMessage[] = [];
  async publishJob(message: JobMessage): Promise<void> {
    this.published.push(message);
  }
}

/** Storage que falla al subir (S3 caído / sin permisos). */
class FailingStorage extends FakeStorage {
  override async putObject(): Promise<void> {
    throw new Error("S3 no disponible");
  }
}

/** Cola que falla al publicar (SQS caído / sin permisos). */
class FailingQueue extends FakeQueue {
  override async publishJob(): Promise<void> {
    throw new Error("SQS no disponible");
  }
}

// Stub mínimo de Db: solo se usa para el healthcheck (SELECT 1).
const fakeDb = { query: async () => ({ rows: [{ "?column?": 1 }] }) } as never;

/** Construye un cuerpo multipart/form-data con un único campo `file`. */
function multipartFile(filename: string, contentType: string, content: string) {
  const boundary = "----vitestboundary";
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--\r\n`;
  return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe("resultFilename", () => {
  it("cambia la extensión por -procesado.png", () => {
    expect(resultFilename("vacaciones.jpeg")).toBe("vacaciones-procesado.png");
    expect(resultFilename("sin-extension")).toBe("sin-extension-procesado.png");
    expect(resultFilename(".png")).toBe("imagen-procesado.png");
  });
});

describe("rutas de jobs", () => {
  let app: FastifyInstance;
  let repo: InMemoryJobsRepository;
  let storage: FakeStorage;
  let queue: FakeQueue;

  beforeEach(async () => {
    repo = new InMemoryJobsRepository();
    storage = new FakeStorage();
    queue = new FakeQueue();
    app = await buildApp({ db: fakeDb, repo, storage, queue, presignExpiresSeconds: 600 });
    await app.ready();
  });

  it("GET /health responde ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("POST /jobs sube el original, publica en la cola y devuelve 201", async () => {
    const { body, headers } = multipartFile("foto.png", "image/png", "bytes-de-imagen");
    const res = await app.inject({ method: "POST", url: "/jobs", headers, payload: body });

    expect(res.statusCode).toBe(201);
    const { job } = res.json();
    expect(job.status).toBe(JobStatus.Pending);
    expect(job.originalFilename).toBe("foto.png");
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0]!.key).toBe(job.s3KeyOriginal);
    expect(queue.published).toEqual([{ jobId: job.id }]);
  });

  it("POST /jobs sin archivo responde 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/jobs",
      headers: { "content-type": "multipart/form-data; boundary=----x" },
      payload: "------x--\r\n",
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /jobs con MIME no permitido responde 415", async () => {
    const { body, headers } = multipartFile("nota.txt", "text/plain", "hola");
    const res = await app.inject({ method: "POST", url: "/jobs", headers, payload: body });
    expect(res.statusCode).toBe(415);
    expect(storage.puts).toHaveLength(0);
    expect(queue.published).toHaveLength(0);
  });

  it("POST /jobs con archivo mayor al límite responde 413", async () => {
    const small = await buildApp({ db: fakeDb, repo, storage, queue, maxUploadBytes: 10 });
    await small.ready();
    const { body, headers } = multipartFile("foto.png", "image/png", "x".repeat(100));
    const res = await small.inject({ method: "POST", url: "/jobs", headers, payload: body });
    expect(res.statusCode).toBe(413);
    expect(repo.jobs).toHaveLength(0);
    expect(storage.puts).toHaveLength(0);
    expect(queue.published).toHaveLength(0);
    await small.close();
  });

  it("POST /jobs sin multipart responde 406 (no 413)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/jobs",
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(res.statusCode).toBe(406);
  });

  it("GET /jobs/:id devuelve 404 si no existe", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/jobs/11111111-1111-1111-1111-111111111111",
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /jobs/:id devuelve 400 si el id no es uuid", async () => {
    const res = await app.inject({ method: "GET", url: "/jobs/no-uuid" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /jobs lista con paginación", async () => {
    await repo.create({ originalFilename: "a.png" });
    await repo.create({ originalFilename: "b.png" });
    await repo.create({ originalFilename: "c.png" });

    const res = await app.inject({ method: "GET", url: "/jobs?limit=2&offset=0" });
    expect(res.statusCode).toBe(200);
    const bodyJson = res.json();
    expect(bodyJson.total).toBe(3);
    expect(bodyJson.jobs).toHaveLength(2);
    expect(bodyJson.limit).toBe(2);
  });

  it("GET /jobs rechaza limit fuera de rango", async () => {
    const res = await app.inject({ method: "GET", url: "/jobs?limit=9999" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /jobs/:id/download devuelve 409 si el job no está done", async () => {
    const job = await repo.create({ originalFilename: "foto.png" });
    const res = await app.inject({ method: "GET", url: `/jobs/${job.id}/download` });
    expect(res.statusCode).toBe(409);
  });

  it("GET /jobs/:id/download devuelve la URL prefirmada si está done", async () => {
    const job = repo.seedDone();
    const res = await app.inject({ method: "GET", url: `/jobs/${job.id}/download` });
    expect(res.statusCode).toBe(200);
    const bodyJson = res.json();
    expect(bodyJson.url).toContain(`results/${job.id}`);
    expect(bodyJson.expiresInSeconds).toBe(600);
    // El contrato compartido con web (Fase 3) valida la respuesta.
    expect(presignedUrlResponseSchema.safeParse(bodyJson).success).toBe(true);
    // Se firma como descarga (attachment) con un nombre derivado del original.
    expect(storage.downloadFilenames).toEqual(["foto-procesado.png"]);
  });

  it("CORS permite al front (preflight desde el origen de web)", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/jobs",
      headers: {
        origin: "http://localhost:8080",
        "access-control-request-method": "POST",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBeTruthy();
  });

  it("GET /jobs/:id/download devuelve 404 si el job no existe", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/jobs/11111111-1111-1111-1111-111111111111/download",
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /jobs/:id/download devuelve 400 si el id no es uuid", async () => {
    const res = await app.inject({ method: "GET", url: "/jobs/no-uuid/download" });
    expect(res.statusCode).toBe(400);
  });

  it.each(["image/jpeg", "image/webp", "image/gif"])(
    "POST /jobs acepta %s y lo sube con ese Content-Type",
    async (mime) => {
      const { body, headers } = multipartFile("foto.img", mime, "bytes");
      const res = await app.inject({ method: "POST", url: "/jobs", headers, payload: body });
      expect(res.statusCode).toBe(201);
      expect(storage.puts[0]!.contentType).toBe(mime);
    },
  );

  it("POST /jobs devuelve un body que cumple createJobResponseSchema", async () => {
    const { body, headers } = multipartFile("foto.png", "image/png", "bytes");
    const res = await app.inject({ method: "POST", url: "/jobs", headers, payload: body });
    expect(res.statusCode).toBe(201);
    // Los ids del repo en memoria son uuid válidos en forma; el contrato debe cumplirse.
    const parsed = createJobResponseSchema.safeParse(res.json());
    expect(parsed.success).toBe(true);
  });

  it("POST /jobs no deja un job pending huérfano si falla la subida a S3", async () => {
    const broken = await buildApp({ db: fakeDb, repo, storage: new FailingStorage(), queue });
    await broken.ready();
    const { body, headers } = multipartFile("foto.png", "image/png", "bytes");
    const res = await broken.inject({ method: "POST", url: "/jobs", headers, payload: body });

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(queue.published).toHaveLength(0);
    // Nadie va a encolar ese job nunca: no puede quedar `pending` para siempre.
    expect(repo.jobs.filter((j) => j.status === JobStatus.Pending)).toEqual([]);
    await broken.close();
  });

  it("POST /jobs no deja un job pending huérfano si falla la publicación en SQS", async () => {
    const broken = await buildApp({ db: fakeDb, repo, storage, queue: new FailingQueue() });
    await broken.ready();
    const { body, headers } = multipartFile("foto.png", "image/png", "bytes");
    const res = await broken.inject({ method: "POST", url: "/jobs", headers, payload: body });

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    // El original quedó en S3 pero el worker nunca recibirá el mensaje.
    expect(repo.jobs.filter((j) => j.status === JobStatus.Pending)).toEqual([]);
    // Queda visible como error en el front, con un motivo legible.
    expect(repo.jobs.map((j) => [j.status, j.errorMessage])).toEqual([
      [JobStatus.Error, "No se pudo encolar la imagen para procesarla"],
    ]);
    await broken.close();
  });
});
