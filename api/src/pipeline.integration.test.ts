import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import runner from "node-pg-migrate";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { CreateBucketCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { CreateQueueCommand, ReceiveMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { S3Client } from "@aws-sdk/client-s3";
import { JobStatus, jobMessageSchema, type Job } from "@app/types";
import { createPool, type Db } from "./db.js";
import type { AwsConfig } from "./config.js";
import { createPresignS3Client, createS3Client, createSqsClient } from "./aws.js";
import { S3ObjectStorage } from "./storage.js";
import { SqsJobQueue } from "./queue.js";
import { buildApp } from "./app.js";

// API contra Postgres + LocalStack REALES (Testcontainers). Se activa con DOCKER_TESTS=1.
// La API solo tiene `testcontainers` como devDependency, así que LocalStack se levanta
// con GenericContainer en vez de @testcontainers/localstack.
const runDocker = process.env.DOCKER_TESTS === "1";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

const BUCKET = "images-bucket";
const QUEUE_NAME = "images-jobs";

/** Cuerpo multipart/form-data con un único campo `file` binario. */
function multipartFile(filename: string, contentType: string, content: Buffer) {
  const boundary = "----vitestboundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

describe.skipIf(!runDocker)(
  "API: POST /jobs y download (integración con LocalStack + Postgres)",
  () => {
    let pgContainer: StartedPostgreSqlContainer;
    let lsContainer: StartedTestContainer;
    let db: Db;
    let s3: S3Client;
    let sqs: SQSClient;
    let queueUrl: string;
    let app: FastifyInstance;

    beforeAll(async () => {
      pgContainer = await new PostgreSqlContainer("postgres:16").start();
      lsContainer = await new GenericContainer("localstack/localstack:3")
        .withEnvironment({ SERVICES: "s3,sqs" })
        .withExposedPorts(4566)
        .withWaitStrategy(Wait.forHttp("/_localstack/health", 4566).forStatusCode(200))
        .start();

      const databaseUrl = pgContainer.getConnectionUri();
      await runner({
        databaseUrl,
        dir: migrationsDir,
        direction: "up",
        migrationsTable: "pgmigrations",
        count: Infinity,
      });
      db = createPool(databaseUrl);

      const endpoint = `http://${lsContainer.getHost()}:${lsContainer.getMappedPort(4566)}`;
      const baseAws: AwsConfig = {
        region: "us-east-1",
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId: "test", secretAccessKey: "test" },
        bucket: BUCKET,
        queueUrl: "",
      };
      s3 = createS3Client(baseAws);
      sqs = createSqsClient(baseAws);
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      queueUrl = (await sqs.send(new CreateQueueCommand({ QueueName: QUEUE_NAME }))).QueueUrl!;

      const awsConfig: AwsConfig = { ...baseAws, queueUrl };
      app = await buildApp({
        db,
        storage: new S3ObjectStorage(s3, BUCKET, createPresignS3Client(awsConfig)),
        queue: new SqsJobQueue(sqs, queueUrl),
        presignExpiresSeconds: 120,
      });
      await app.ready();
    }, 180_000);

    afterAll(async () => {
      await app?.close();
      await db?.end();
      await lsContainer?.stop();
      await pgContainer?.stop();
    });

    it("sube el original a S3, crea el job pending en DB y publica { jobId } en SQS", async () => {
      const png = Buffer.from("89504e470d0a1a0a", "hex"); // basta con bytes; no se procesa acá
      const { body, headers } = multipartFile("foto.png", "image/png", png);
      const res = await app.inject({ method: "POST", url: "/jobs", headers, payload: body });
      expect(res.statusCode).toBe(201);
      const { job } = res.json() as { job: Job };

      // DB: fila pending con la key derivada del id.
      const { rows } = await db.query<{ status: string; s3_key_original: string }>(
        `SELECT status, s3_key_original FROM jobs WHERE id = $1`,
        [job.id],
      );
      expect(rows[0]).toEqual({
        status: JobStatus.Pending,
        s3_key_original: `originals/${job.id}`,
      });

      // S3: el objeto existe con el tamaño y Content-Type subidos.
      const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: job.s3KeyOriginal }));
      expect(head.ContentLength).toBe(png.length);
      expect(head.ContentType).toBe("image/png");

      // SQS: hay un mensaje que cumple el contrato y apunta a este job.
      const received = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 5,
        }),
      );
      const jobIds = (received.Messages ?? []).map(
        (m) => jobMessageSchema.parse(JSON.parse(m.Body!)).jobId,
      );
      expect(jobIds).toContain(job.id);
    });

    it("MIME no permitido: 415 y no deja fila en DB", async () => {
      const before = await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM jobs`);
      const { body, headers } = multipartFile("nota.txt", "text/plain", Buffer.from("hola"));
      const res = await app.inject({ method: "POST", url: "/jobs", headers, payload: body });
      expect(res.statusCode).toBe(415);
      const after = await db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM jobs`);
      expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    });

    it("download: con el job done, la URL prefirmada descarga el resultado real", async () => {
      const { body, headers } = multipartFile("foto.png", "image/png", Buffer.from("orig"));
      const created = await app.inject({ method: "POST", url: "/jobs", headers, payload: body });
      const { job } = created.json() as { job: Job };

      // Simula lo que hace el worker: sube el resultado y marca done.
      const result = Buffer.from("resultado-procesado");
      await s3.send(
        new PutObjectCommand({ Bucket: BUCKET, Key: `results/${job.id}`, Body: result }),
      );
      await db.query(`UPDATE jobs SET status = $1, s3_key_result = $2 WHERE id = $3`, [
        JobStatus.Done,
        `results/${job.id}`,
        job.id,
      ]);

      const res = await app.inject({ method: "GET", url: `/jobs/${job.id}/download` });
      expect(res.statusCode).toBe(200);
      const { url, expiresInSeconds } = res.json() as { url: string; expiresInSeconds: number };
      expect(expiresInSeconds).toBe(120);

      const file = await fetch(url);
      expect(file.status).toBe(200);
      expect(Buffer.from(await file.arrayBuffer()).equals(result)).toBe(true);
    });
  },
);
