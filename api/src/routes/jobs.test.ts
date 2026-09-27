import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { JobStatus, type Job } from "@app/types";
import { buildApp } from "../app.js";
import type { JobsRepository, CreateJobInput } from "../repositories/jobs.js";

/** Repositorio en memoria para probar las rutas sin Postgres. */
class InMemoryJobsRepository implements JobsRepository {
  private jobs: Job[] = [];
  private counter = 0;

  async create(input: CreateJobInput): Promise<Job> {
    this.counter += 1;
    const id = `00000000-0000-0000-0000-${String(this.counter).padStart(12, "0")}`;
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

  async findById(id: string): Promise<Job | null> {
    return this.jobs.find((j) => j.id === id) ?? null;
  }

  async list(limit: number, offset: number): Promise<{ jobs: Job[]; total: number }> {
    return { jobs: this.jobs.slice(offset, offset + limit), total: this.jobs.length };
  }
}

// Stub mínimo de Db: solo se usa para el healthcheck (SELECT 1).
const fakeDb = { query: async () => ({ rows: [{ "?column?": 1 }] }) } as never;

describe("rutas de jobs", () => {
  let app: FastifyInstance;
  let repo: InMemoryJobsRepository;

  beforeEach(async () => {
    repo = new InMemoryJobsRepository();
    app = await buildApp({ db: fakeDb, repo });
    await app.ready();
  });

  it("GET /health responde ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("POST /jobs crea un job pending y devuelve 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/jobs",
      payload: { originalFilename: "foto.png" },
    });
    expect(res.statusCode).toBe(201);
    const { job } = res.json();
    expect(job.status).toBe(JobStatus.Pending);
    expect(job.originalFilename).toBe("foto.png");
    expect(job.s3KeyOriginal).toContain("originals/");
  });

  it("POST /jobs rechaza body inválido con 400", async () => {
    const res = await app.inject({ method: "POST", url: "/jobs", payload: {} });
    expect(res.statusCode).toBe(400);
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
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.jobs).toHaveLength(2);
    expect(body.limit).toBe(2);
  });

  it("GET /jobs rechaza limit fuera de rango", async () => {
    const res = await app.inject({ method: "GET", url: "/jobs?limit=9999" });
    expect(res.statusCode).toBe(400);
  });
});
