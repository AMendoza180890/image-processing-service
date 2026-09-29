import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { JobStatus, type Job } from "@app/types";
import type { WorkerJobsRepository } from "./repository.js";
import type { ObjectStorage } from "./storage.js";
import { handleJob } from "./handler.js";

const silentLogger = { info: () => {}, error: () => {} };

/** Repo en memoria que registra las transiciones de estado. */
class InMemoryRepo implements WorkerJobsRepository {
  constructor(private job: Job | null) {}
  transitions: string[] = [];

  async findById(): Promise<Job | null> {
    return this.job;
  }
  async markProcessing(): Promise<void> {
    this.transitions.push(JobStatus.Processing);
    if (this.job) this.job = { ...this.job, status: JobStatus.Processing };
  }
  async markDone(_id: string, key: string): Promise<void> {
    this.transitions.push(JobStatus.Done);
    if (this.job) this.job = { ...this.job, status: JobStatus.Done, s3KeyResult: key };
  }
  async markError(_id: string, message: string): Promise<void> {
    this.transitions.push(JobStatus.Error);
    if (this.job) this.job = { ...this.job, status: JobStatus.Error, errorMessage: message };
  }
}

class FakeStorage implements ObjectStorage {
  puts: string[] = [];
  constructor(private readonly original: Buffer) {}
  async getObject(): Promise<Buffer> {
    return this.original;
  }
  async putObject(key: string): Promise<void> {
    this.puts.push(key);
  }
}

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: "11111111-1111-1111-1111-111111111111",
    originalFilename: "foto.png",
    s3KeyOriginal: "originals/11111111-1111-1111-1111-111111111111",
    s3KeyResult: null,
    status: JobStatus.Pending,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const processOpts = { thumbnailWidth: 320, watermarkText: "procesado" };

async function validImage(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: "#123456" } })
    .png()
    .toBuffer();
}

describe("handleJob", () => {
  let image: Buffer;
  beforeEach(async () => {
    image = await validImage();
  });

  it("procesa un job pending: processing -> done y sube el resultado", async () => {
    const job = makeJob();
    const repo = new InMemoryRepo(job);
    const storage = new FakeStorage(image);

    const done = await handleJob(job.id, {
      repo,
      storage,
      process: processOpts,
      logger: silentLogger,
    });

    expect(done).toBe(true);
    expect(repo.transitions).toEqual([JobStatus.Processing, JobStatus.Done]);
    expect(storage.puts).toEqual([`results/${job.id}`]);
  });

  it("es idempotente: un job ya done no se reprocesa", async () => {
    const job = makeJob({ status: JobStatus.Done, s3KeyResult: "results/x" });
    const repo = new InMemoryRepo(job);
    const storage = new FakeStorage(image);

    const done = await handleJob(job.id, {
      repo,
      storage,
      process: processOpts,
      logger: silentLogger,
    });

    expect(done).toBe(true);
    expect(repo.transitions).toEqual([]);
    expect(storage.puts).toEqual([]);
  });

  it("reprocesa un job que quedó en processing (el worker murió a mitad)", async () => {
    const job = makeJob({ status: JobStatus.Processing });
    const repo = new InMemoryRepo(job);
    const storage = new FakeStorage(image);

    const done = await handleJob(job.id, {
      repo,
      storage,
      process: processOpts,
      logger: silentLogger,
    });

    expect(done).toBe(true);
    expect(repo.transitions).toEqual([JobStatus.Processing, JobStatus.Done]);
    expect(storage.puts).toEqual([`results/${job.id}`]);
  });

  it("marca error si la imagen es inválida", async () => {
    const job = makeJob();
    const repo = new InMemoryRepo(job);
    const storage = new FakeStorage(Buffer.from("no soy una imagen"));

    const done = await handleJob(job.id, {
      repo,
      storage,
      process: processOpts,
      logger: silentLogger,
    });

    expect(done).toBe(true);
    expect(repo.transitions).toEqual([JobStatus.Processing, JobStatus.Error]);
    expect(storage.puts).toEqual([]);
  });

  it("descarta el mensaje si el job no existe", async () => {
    const repo = new InMemoryRepo(null);
    const storage = new FakeStorage(image);

    const done = await handleJob("missing", {
      repo,
      storage,
      process: processOpts,
      logger: silentLogger,
    });

    expect(done).toBe(true);
    expect(repo.transitions).toEqual([]);
  });
});
