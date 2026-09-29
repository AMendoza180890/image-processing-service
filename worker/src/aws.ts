import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { WorkerAwsConfig } from "./config.js";

/** Clientes AWS SDK v3. En local apuntan a LocalStack vía `endpoint` + path-style. */
export function createS3Client(cfg: WorkerAwsConfig): S3Client {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: cfg.credentials,
  });
}

export function createSqsClient(cfg: WorkerAwsConfig): SQSClient {
  return new SQSClient({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: cfg.credentials,
  });
}
