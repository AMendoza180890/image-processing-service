import { loadWorkerConfig } from "./config.js";
import { createPool } from "./db.js";
import { createS3Client, createSqsClient } from "./aws.js";
import { PgWorkerJobsRepository } from "./repository.js";
import { S3ObjectStorage } from "./storage.js";
import { SqsJobQueue } from "./queue.js";
import { runLoop } from "./worker.js";

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const db = createPool(config.databaseUrl);
  const repo = new PgWorkerJobsRepository(db);
  const storage = new S3ObjectStorage(createS3Client(config.aws), config.aws.bucket);
  const queue = new SqsJobQueue(createSqsClient(config.aws), config.aws.queueUrl);

  const controller = new AbortController();
  const shutdown = (signal: string): void => {
    console.info(`Recibida señal ${signal}, deteniendo worker...`);
    controller.abort();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  await runLoop({
    queue,
    handleDeps: {
      repo,
      storage,
      process: {
        thumbnailWidth: config.thumbnailWidth,
        watermarkText: config.watermarkText,
      },
    },
    pollWaitSeconds: config.pollWaitSeconds,
    signal: controller.signal,
  });

  await db.end();
}

main().catch((err) => {
  console.error("Fallo al iniciar el worker:", err);
  process.exit(1);
});
