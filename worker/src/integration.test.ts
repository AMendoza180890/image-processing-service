import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import runner from "node-pg-migrate";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { LocalstackContainer, type StartedLocalStackContainer } from "@testcontainers/localstack";
import { CreateBucketCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SendMessageCommand,
} from "@aws-sdk/client-sqs";
import { JobStatus } from "@app/types";
import { createPool, type Db } from "./db.js";
import { createS3Client, createSqsClient } from "./aws.js";
import { PgWorkerJobsRepository } from "./repository.js";
import { S3ObjectStorage } from "./storage.js";
import { SqsJobQueue } from "./queue.js";
import { processBatch } from "./worker.js";

// Levanta Postgres + LocalStack REALES vía Docker. Se activa con DOCKER_TESTS=1.
const runDocker = process.env.DOCKER_TESTS === "1";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

const BUCKET = "images-bucket";
const QUEUE_NAME = "images-jobs";

describe.skipIf(!runDocker)("worker (integración con LocalStack + Postgres)", () => {
  let pgContainer: StartedPostgreSqlContainer;
  let lsContainer: StartedLocalStackContainer;
  let db: Db;
  let repo: PgWorkerJobsRepository;
  let storage: S3ObjectStorage;
  let queue: SqsJobQueue;
  let queueUrl: string;

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer("postgres:16").start();
    lsContainer = await new LocalstackContainer("localstack/localstack:3").start();

    const databaseUrl = pgContainer.getConnectionUri();
    await runner({
      databaseUrl,
      dir: migrationsDir,
      direction: "up",
      migrationsTable: "pgmigrations",
      count: Infinity,
    });
    db = createPool(databaseUrl);
    repo = new PgWorkerJobsRepository(db);

    const awsConfig = {
      region: "us-east-1",
      endpoint: lsContainer.getConnectionUri(),
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      bucket: BUCKET,
      queueUrl: "",
    };
    const s3 = createS3Client(awsConfig);
    const sqs = createSqsClient(awsConfig);

    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    const created = await sqs.send(new CreateQueueCommand({ QueueName: QUEUE_NAME }));
    queueUrl = created.QueueUrl!;

    storage = new S3ObjectStorage(s3, BUCKET);
    queue = new SqsJobQueue(sqs, queueUrl);

    // Sube un original de prueba y encola el job.
    const image = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#3366aa" },
    })
      .png()
      .toBuffer();
    const jobId = randomUUID();
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `originals/${jobId}`,
        Body: image,
        ContentType: "image/png",
      }),
    );
    await db.query(
      `INSERT INTO jobs (id, original_filename, s3_key_original, status)
       VALUES ($1, $2, $3, $4)`,
      [jobId, "foto.png", `originals/${jobId}`, JobStatus.Pending],
    );
    await sqs.send(
      new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ jobId }) }),
    );

    // Guarda para el assert.
    (globalThis as Record<string, unknown>).__jobId = jobId;
    (globalThis as Record<string, unknown>).__s3 = s3;
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await lsContainer?.stop();
    await pgContainer?.stop();
  });

  it("consume el mensaje, procesa la imagen y marca el job done", async () => {
    const controller = new AbortController();
    const processed = await processBatch({
      queue,
      handleDeps: {
        repo,
        storage,
        process: { thumbnailWidth: 320, watermarkText: "procesado" },
        logger: { info: () => {}, error: () => {} },
      },
      pollWaitSeconds: 5,
      signal: controller.signal,
      logger: { info: () => {}, error: () => {} },
    });
    expect(processed).toBeGreaterThanOrEqual(1);

    const jobId = (globalThis as Record<string, unknown>).__jobId as string;
    const s3 = (globalThis as Record<string, unknown>).__s3 as ReturnType<typeof createS3Client>;

    const job = await repo.findById(jobId);
    expect(job?.status).toBe(JobStatus.Done);
    expect(job?.s3KeyResult).toBe(`results/${jobId}`);

    // El objeto resultado existe en S3.
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: `results/${jobId}` }));
    expect(head.ContentLength).toBeGreaterThan(0);
  }, 60_000);

  const silent = { info: () => {}, error: () => {} };

  /** Corre tandas hasta vaciar la cola (o agotar intentos). */
  async function drainQueue(): Promise<void> {
    for (let i = 0; i < 5; i++) {
      const n = await processBatch({
        queue,
        handleDeps: {
          repo,
          storage,
          process: { thumbnailWidth: 320, watermarkText: "procesado" },
          logger: silent,
        },
        pollWaitSeconds: 1,
        signal: new AbortController().signal,
        logger: silent,
      });
      if (n === 0) return;
    }
  }

  /** Cliente SQS contra el LocalStack del test. */
  function lsSqs() {
    return createSqsClient({
      region: "us-east-1",
      endpoint: lsContainer.getConnectionUri(),
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
      bucket: BUCKET,
      queueUrl,
    });
  }

  async function visibleMessages(): Promise<number> {
    const sqs = lsSqs();
    const attrs = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
      }),
    );
    return (
      Number(attrs.Attributes?.ApproximateNumberOfMessages ?? 0) +
      Number(attrs.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0)
    );
  }

  it("imagen corrupta: el job queda en error con mensaje, sin resultado, y la cola se vacía", async () => {
    const s3 = (globalThis as Record<string, unknown>).__s3 as ReturnType<typeof createS3Client>;
    const sqs = lsSqs();
    const jobId = randomUUID();
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `originals/${jobId}`,
        Body: Buffer.from("esto no es un png"),
        ContentType: "image/png",
      }),
    );
    await db.query(
      `INSERT INTO jobs (id, original_filename, s3_key_original, status)
       VALUES ($1, $2, $3, $4)`,
      [jobId, "roto.png", `originals/${jobId}`, JobStatus.Pending],
    );
    await sqs.send(
      new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ jobId }) }),
    );

    await drainQueue();

    const job = await repo.findById(jobId);
    expect(job?.status).toBe(JobStatus.Error);
    expect(job?.errorMessage).toBeTruthy();
    expect(job?.s3KeyResult).toBeNull();
    await expect(
      s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: `results/${jobId}` })),
    ).rejects.toThrow();
    // El mensaje venenoso no queda dando vueltas en la cola.
    expect(await visibleMessages()).toBe(0);
  }, 60_000);

  it("redelivery de un job done: no lo reprocesa ni lo saca de done", async () => {
    const jobId = (globalThis as Record<string, unknown>).__jobId as string;
    const s3 = (globalThis as Record<string, unknown>).__s3 as ReturnType<typeof createS3Client>;
    const sqs = lsSqs();
    const before = await repo.findById(jobId);
    expect(before?.status).toBe(JobStatus.Done);
    const headBefore = await s3.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: `results/${jobId}` }),
    );

    await sqs.send(
      new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ jobId }) }),
    );
    await drainQueue();

    const after = await repo.findById(jobId);
    expect(after?.status).toBe(JobStatus.Done);
    // Sin UPDATE: el trigger no tocó updated_at.
    expect(after?.updatedAt).toBe(before?.updatedAt);
    const headAfter = await s3.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: `results/${jobId}` }),
    );
    expect(headAfter.ETag).toBe(headBefore.ETag);
    expect(headAfter.LastModified?.getTime()).toBe(headBefore.LastModified?.getTime());
    expect(await visibleMessages()).toBe(0);
  }, 60_000);
});
