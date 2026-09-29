import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { JobStatus, type Job } from "@app/types";
import type { JobQueue, QueueMessage } from "./queue.js";
import type { WorkerJobsRepository } from "./repository.js";
import type { ObjectStorage } from "./storage.js";
import type { HandleJobDeps } from "./handler.js";
import { processBatch, runLoop } from "./worker.js";

const silentLogger = { info: () => {}, error: () => {} };

const JOB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** Cola en memoria: entrega una tanda fija y registra qué se borró. */
class FakeQueue implements JobQueue {
  deleted: string[] = [];
  receiveCalls = 0;
  constructor(private batch: QueueMessage[]) {}
  async receiveMessages(): Promise<QueueMessage[]> {
    this.receiveCalls += 1;
    const out = this.batch;
    this.batch = [];
    return out;
  }
  async deleteMessage(receiptHandle: string): Promise<void> {
    this.deleted.push(receiptHandle);
  }
}

/** Repo en memoria con varios jobs; `failOn` simula la DB caída para un id. */
class InMemoryRepo implements WorkerJobsRepository {
  jobs = new Map<string, Job>();
  constructor(
    jobs: Job[],
    private readonly failOn?: string,
  ) {
    for (const j of jobs) this.jobs.set(j.id, j);
  }
  async findById(id: string): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }
  async markProcessing(id: string): Promise<void> {
    if (id === this.failOn) throw new Error("conexión a Postgres perdida");
    this.patch(id, { status: JobStatus.Processing });
  }
  async markDone(id: string, key: string): Promise<void> {
    this.patch(id, { status: JobStatus.Done, s3KeyResult: key });
  }
  async markError(id: string, message: string): Promise<void> {
    this.patch(id, { status: JobStatus.Error, errorMessage: message });
  }
  private patch(id: string, changes: Partial<Job>): void {
    const job = this.jobs.get(id);
    if (job) this.jobs.set(id, { ...job, ...changes });
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

function makeJob(id: string, overrides: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id,
    originalFilename: "foto.png",
    s3KeyOriginal: `originals/${id}`,
    s3KeyResult: null,
    status: JobStatus.Pending,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function msg(body: unknown, receiptHandle: string): QueueMessage {
  return { body: typeof body === "string" ? body : JSON.stringify(body), receiptHandle };
}

describe("processBatch", () => {
  let image: Buffer;
  beforeEach(async () => {
    image = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#123456" } })
      .png()
      .toBuffer();
  });

  function deps(repo: WorkerJobsRepository, storage: ObjectStorage): HandleJobDeps {
    return {
      repo,
      storage,
      process: { thumbnailWidth: 32, watermarkText: "x" },
      logger: silentLogger,
    };
  }

  it("procesa un mensaje válido, deja el job done y borra el mensaje", async () => {
    const repo = new InMemoryRepo([makeJob(JOB_A)]);
    const queue = new FakeQueue([msg({ jobId: JOB_A }, "rh-a")]);

    const n = await processBatch({
      queue,
      handleDeps: deps(repo, new FakeStorage(image)),
      pollWaitSeconds: 0,
      signal: new AbortController().signal,
      logger: silentLogger,
    });

    expect(n).toBe(1);
    expect(repo.jobs.get(JOB_A)!.status).toBe(JobStatus.Done);
    expect(queue.deleted).toEqual(["rh-a"]);
  });

  it.each([
    ["JSON inválido", "{no-json"],
    ["sin jobId", { foo: 1 }],
    ["jobId no uuid", { jobId: "123" }],
  ])("descarta un mensaje venenoso (%s) sin tocar la DB", async (_label, body) => {
    const repo = new InMemoryRepo([makeJob(JOB_A)]);
    const queue = new FakeQueue([msg(body, "rh-poison")]);

    await processBatch({
      queue,
      handleDeps: deps(repo, new FakeStorage(image)),
      pollWaitSeconds: 0,
      signal: new AbortController().signal,
      logger: silentLogger,
    });

    expect(queue.deleted).toEqual(["rh-poison"]);
    expect(repo.jobs.get(JOB_A)!.status).toBe(JobStatus.Pending);
  });

  it("un mensaje venenoso no impide procesar el resto de la tanda", async () => {
    const repo = new InMemoryRepo([makeJob(JOB_A)]);
    const queue = new FakeQueue([msg("basura", "rh-poison"), msg({ jobId: JOB_A }, "rh-a")]);

    await processBatch({
      queue,
      handleDeps: deps(repo, new FakeStorage(image)),
      pollWaitSeconds: 0,
      signal: new AbortController().signal,
      logger: silentLogger,
    });

    expect(queue.deleted).toEqual(["rh-poison", "rh-a"]);
    expect(repo.jobs.get(JOB_A)!.status).toBe(JobStatus.Done);
  });

  it("redelivery del mismo jobId: el segundo mensaje no reprocesa ni resube", async () => {
    const repo = new InMemoryRepo([makeJob(JOB_A)]);
    const storage = new FakeStorage(image);
    const queue = new FakeQueue([msg({ jobId: JOB_A }, "rh-1"), msg({ jobId: JOB_A }, "rh-2")]);

    await processBatch({
      queue,
      handleDeps: deps(repo, storage),
      pollWaitSeconds: 0,
      signal: new AbortController().signal,
      logger: silentLogger,
    });

    expect(storage.puts).toEqual([`results/${JOB_A}`]);
    expect(queue.deleted).toEqual(["rh-1", "rh-2"]);
    expect(repo.jobs.get(JOB_A)!.status).toBe(JobStatus.Done);
  });

  it("imagen corrupta: el job queda en error con mensaje y el mensaje se borra", async () => {
    const repo = new InMemoryRepo([makeJob(JOB_A)]);
    const queue = new FakeQueue([msg({ jobId: JOB_A }, "rh-a")]);

    await processBatch({
      queue,
      handleDeps: deps(repo, new FakeStorage(Buffer.from("no soy una imagen"))),
      pollWaitSeconds: 0,
      signal: new AbortController().signal,
      logger: silentLogger,
    });

    const job = repo.jobs.get(JOB_A)!;
    expect(job.status).toBe(JobStatus.Error);
    expect(job.errorMessage).toBeTruthy();
    expect(queue.deleted).toEqual(["rh-a"]);
  });

  it("no borra el mensaje si falla la DB (error transitorio): SQS lo reentrega", async () => {
    const repo = new InMemoryRepo([makeJob(JOB_A)], JOB_A);
    const queue = new FakeQueue([msg({ jobId: JOB_A }, "rh-a")]);

    const errors: string[] = [];
    // El fallo se contiene por mensaje (no aborta la tanda), pero se registra.
    await processBatch({
      queue,
      handleDeps: deps(repo, new FakeStorage(image)),
      pollWaitSeconds: 0,
      signal: new AbortController().signal,
      logger: { info: () => {}, error: (m: string) => errors.push(m) },
    });
    expect(queue.deleted).not.toContain("rh-a");
    expect(errors.some((m) => m.includes(JOB_A))).toBe(true);
  });

  it("un fallo transitorio en un job no deja sin procesar al resto de la tanda", async () => {
    const repo = new InMemoryRepo([makeJob(JOB_A), makeJob(JOB_B)], JOB_A);
    const queue = new FakeQueue([msg({ jobId: JOB_A }, "rh-a"), msg({ jobId: JOB_B }, "rh-b")]);

    await processBatch({
      queue,
      handleDeps: deps(repo, new FakeStorage(image)),
      pollWaitSeconds: 0,
      signal: new AbortController().signal,
      logger: silentLogger,
    }).catch(() => {});

    expect(repo.jobs.get(JOB_B)!.status).toBe(JobStatus.Done);
    expect(queue.deleted).toEqual(["rh-b"]);
  });
});

describe("runLoop", () => {
  it("se detiene cuando se aborta la señal", async () => {
    const controller = new AbortController();
    const queue = new FakeQueue([]);
    const original = queue.receiveMessages.bind(queue);
    queue.receiveMessages = async () => {
      const out = await original();
      if (queue.receiveCalls >= 3) controller.abort();
      return out;
    };

    await runLoop({
      queue,
      handleDeps: {
        repo: new InMemoryRepo([]),
        storage: new FakeStorage(Buffer.alloc(0)),
        process: { thumbnailWidth: 32, watermarkText: "x" },
      },
      pollWaitSeconds: 0,
      signal: controller.signal,
      logger: silentLogger,
    });

    expect(queue.receiveCalls).toBe(3);
  });

  // Si SQS está caído, receiveMessages falla al instante: sin espera entre reintentos
  // el loop gira en caliente (CPU al 100% y logs inundados).
  it("espera entre reintentos cuando la cola falla (backoff)", async () => {
    const controller = new AbortController();
    const calls: number[] = [];
    const queue = new FakeQueue([]);
    queue.receiveMessages = async () => {
      calls.push(Date.now());
      if (calls.length >= 2) controller.abort();
      throw new Error("SQS no disponible");
    };

    await runLoop({
      queue,
      handleDeps: {
        repo: new InMemoryRepo([]),
        storage: new FakeStorage(Buffer.alloc(0)),
        process: { thumbnailWidth: 32, watermarkText: "x" },
      },
      pollWaitSeconds: 0,
      signal: controller.signal,
      logger: silentLogger,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]! - calls[0]!).toBeGreaterThanOrEqual(100);
  }, 30_000);
});
