/**
 * Configuración de la API leída del entorno.
 * Falla temprano (fail-fast) si falta algo esencial.
 */
export interface AwsConfig {
  region: string;
  /** Endpoint custom (LocalStack). Vacío/omitido en AWS real → SDK usa el default. */
  endpoint?: string;
  /**
   * Endpoint con el que se firman las URLs prefirmadas. La firma incluye el host, así que
   * debe ser el que ve el cliente (ej. http://localhost:4566), no el DNS interno de compose.
   * Omitido → se usa `endpoint`.
   */
  publicEndpoint?: string;
  forcePathStyle: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  bucket: string;
  queueUrl: string;
}

export interface ApiConfig {
  port: number;
  databaseUrl: string;
  corsOrigin: string;
  aws: AwsConfig;
  /** Expiración de las URLs prefirmadas de descarga (segundos). */
  presignExpiresSeconds: number;
  /** Tamaño máximo aceptado en la subida (bytes). */
  maxUploadBytes: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Falta la variable de entorno requerida: ${name}`);
  }
  return value;
}

/**
 * Credenciales solo si ambas están presentes (LocalStack usa test/test).
 * En AWS real se dejan al proveedor de credenciales por defecto del SDK.
 */
function optionalCredentials(): AwsConfig["credentials"] {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (accessKeyId && secretAccessKey) {
    return { accessKeyId, secretAccessKey };
  }
  return undefined;
}

/** Número positivo desde el entorno (o el default); NaN, 0 o negativos fallan temprano. */
function positiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} debe ser un número positivo (recibido: "${raw}")`);
  }
  return value;
}

export function loadConfig(): ApiConfig {
  return {
    port: positiveNumber("API_PORT", 3000),
    databaseUrl: required("DATABASE_URL"),
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    aws: {
      region: process.env.AWS_REGION ?? "us-east-1",
      endpoint: process.env.AWS_ENDPOINT_URL || undefined,
      publicEndpoint: process.env.S3_PUBLIC_ENDPOINT_URL || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: optionalCredentials(),
      bucket: required("S3_BUCKET"),
      queueUrl: required("SQS_QUEUE_URL"),
    },
    presignExpiresSeconds: positiveNumber("PRESIGN_EXPIRES_SECONDS", 900),
    maxUploadBytes: positiveNumber("MAX_UPLOAD_MB", 10) * 1024 * 1024,
  };
}
