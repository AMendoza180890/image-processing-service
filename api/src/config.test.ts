import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";

const REQUIRED = {
  DATABASE_URL: "postgres://app:pw@localhost:5432/images",
  S3_BUCKET: "images-bucket",
  SQS_QUEUE_URL: "http://localhost:4566/000000000000/images-jobs",
};

const TOUCHED = [
  ...Object.keys(REQUIRED),
  "AWS_ENDPOINT_URL",
  "S3_PUBLIC_ENDPOINT_URL",
  "S3_FORCE_PATH_STYLE",
  "MAX_UPLOAD_MB",
  "PRESIGN_EXPIRES_SECONDS",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
];

describe("loadConfig (Fase 2)", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
    for (const k of TOUCHED) delete process.env[k];
    Object.assign(process.env, REQUIRED);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("convierte MAX_UPLOAD_MB a bytes y lee el endpoint público", () => {
    process.env.MAX_UPLOAD_MB = "5";
    process.env.AWS_ENDPOINT_URL = "http://localstack:4566";
    process.env.S3_PUBLIC_ENDPOINT_URL = "http://localhost:4566";
    process.env.S3_FORCE_PATH_STYLE = "true";
    const cfg = loadConfig();
    expect(cfg.maxUploadBytes).toBe(5 * 1024 * 1024);
    expect(cfg.aws.endpoint).toBe("http://localstack:4566");
    expect(cfg.aws.publicEndpoint).toBe("http://localhost:4566");
    expect(cfg.aws.forcePathStyle).toBe(true);
  });

  it("usa defaults: 10 MB, 900 s y sin endpoints custom", () => {
    const cfg = loadConfig();
    expect(cfg.maxUploadBytes).toBe(10 * 1024 * 1024);
    expect(cfg.presignExpiresSeconds).toBe(900);
    expect(cfg.aws.endpoint).toBeUndefined();
    expect(cfg.aws.publicEndpoint).toBeUndefined();
    expect(cfg.aws.credentials).toBeUndefined();
  });

  it("falla temprano si falta S3_BUCKET o SQS_QUEUE_URL", () => {
    delete process.env.S3_BUCKET;
    expect(() => loadConfig()).toThrow(/S3_BUCKET/);
    process.env.S3_BUCKET = "images-bucket";
    delete process.env.SQS_QUEUE_URL;
    expect(() => loadConfig()).toThrow(/SQS_QUEUE_URL/);
  });

  // Un MAX_UPLOAD_MB mal escrito da NaN; @fastify/multipart hace `fileSize || bodyLimit`
  // y el límite pasa en silencio a 1 MiB. Debe fallar temprano como el resto de la config.
  it("falla temprano si MAX_UPLOAD_MB no es un número positivo", () => {
    process.env.MAX_UPLOAD_MB = "diez";
    expect(() => loadConfig()).toThrow(/MAX_UPLOAD_MB/);
  });

  it("falla temprano si PRESIGN_EXPIRES_SECONDS no es un número positivo", () => {
    process.env.PRESIGN_EXPIRES_SECONDS = "quince-minutos";
    expect(() => loadConfig()).toThrow(/PRESIGN_EXPIRES_SECONDS/);
  });
});
