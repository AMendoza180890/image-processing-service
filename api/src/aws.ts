import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import type { AwsConfig } from "./config.js";

/**
 * Clientes AWS SDK v3. En local apuntan a LocalStack vía `endpoint` + path-style;
 * en AWS real `endpoint` va vacío y el SDK resuelve el endpoint estándar.
 */
export function createS3Client(cfg: AwsConfig): S3Client {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: cfg.credentials,
  });
}

/**
 * Cliente S3 solo para firmar URLs de descarga: usa el endpoint público si está
 * configurado (la firma SigV4 cubre el host, no se puede reescribir después).
 */
export function createPresignS3Client(cfg: AwsConfig): S3Client {
  return createS3Client({ ...cfg, endpoint: cfg.publicEndpoint ?? cfg.endpoint });
}

export function createSqsClient(cfg: AwsConfig): SQSClient {
  return new SQSClient({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: cfg.credentials,
  });
}
