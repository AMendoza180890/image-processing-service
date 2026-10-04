/**
 * Configuración del worker leída del entorno. Comparte convenciones con la API
 * (mismas variables AWS/DB) pero es un servicio independiente.
 */
export interface WorkerAwsConfig {
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  bucket: string;
  queueUrl: string;
}

export interface WorkerConfig {
  databaseUrl: string;
  aws: WorkerAwsConfig;
  /** Segundos de espera del long-polling de SQS (0–20). */
  pollWaitSeconds: number;
  /** Ancho del thumbnail generado (px). */
  thumbnailWidth: number;
  /** Texto de la marca de agua. */
  watermarkText: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Falta la variable de entorno requerida: ${name}`);
  }
  return value;
}

function optionalCredentials(): WorkerAwsConfig["credentials"] {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    return { accessKeyId, secretAccessKey };
  }
  return undefined;
}

/** Número desde el entorno (o el default) dentro de [min, max]; si no, falla temprano. */
function numberInRange(name: string, fallback: number, min: number, max = Infinity): number {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} debe ser un número entre ${min} y ${max} (recibido: "${raw}")`);
  }
  return value;
}

export function loadWorkerConfig(): WorkerConfig {
  return {
    databaseUrl: required("DATABASE_URL"),
    aws: {
      region: process.env.AWS_REGION ?? "us-east-1",
      endpoint: process.env.AWS_ENDPOINT_URL || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: optionalCredentials(),
      bucket: required("S3_BUCKET"),
      queueUrl: required("SQS_QUEUE_URL"),
    },
    // SQS acepta WaitTimeSeconds entre 0 y 20.
    pollWaitSeconds: numberInRange("WORKER_POLL_WAIT_SECONDS", 20, 0, 20),
    thumbnailWidth: numberInRange("THUMBNAIL_WIDTH", 320, 1),
    watermarkText: process.env.WATERMARK_TEXT ?? "procesado",
  };
}
