import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { createPresignS3Client, createS3Client, createSqsClient } from "./aws.js";
import { S3ObjectStorage } from "./storage.js";
import { SqsJobQueue } from "./queue.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createPool(config.databaseUrl);
  const storage = new S3ObjectStorage(
    createS3Client(config.aws),
    config.aws.bucket,
    createPresignS3Client(config.aws),
  );
  const queue = new SqsJobQueue(createSqsClient(config.aws), config.aws.queueUrl);

  const app = await buildApp({
    db,
    storage,
    queue,
    corsOrigin: config.corsOrigin,
    presignExpiresSeconds: config.presignExpiresSeconds,
    maxUploadBytes: config.maxUploadBytes,
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Recibida señal ${signal}, cerrando...`);
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // host 0.0.0.0 es imprescindible dentro de contenedores.
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error("Fallo al iniciar la API:", err);
  process.exit(1);
});
