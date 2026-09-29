import { describe, it, expect } from "vitest";
import { createPresignS3Client, createS3Client } from "./aws.js";
import type { AwsConfig } from "./config.js";
import { S3ObjectStorage, contentDisposition } from "./storage.js";

// Firmar una URL es un cálculo local (SigV4): no hace falta LocalStack.
const baseConfig: AwsConfig = {
  region: "us-east-1",
  endpoint: "http://localstack:4566",
  publicEndpoint: "http://localhost:4566",
  forcePathStyle: true,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
  bucket: "images-bucket",
  queueUrl: "http://localstack:4566/000000000000/images-jobs",
};

function storageFor(cfg: AwsConfig): S3ObjectStorage {
  return new S3ObjectStorage(createS3Client(cfg), cfg.bucket, createPresignS3Client(cfg));
}

describe("S3ObjectStorage.getSignedDownloadUrl", () => {
  it("firma con el endpoint público (host visible), no con el DNS interno de compose", async () => {
    const url = new URL(await storageFor(baseConfig).getSignedDownloadUrl("results/abc", 600));
    expect(url.host).toBe("localhost:4566");
    // Path-style: /<bucket>/<key>
    expect(url.pathname).toBe("/images-bucket/results/abc");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("con nombre de descarga, firma Content-Disposition: attachment", async () => {
    const url = new URL(
      await storageFor(baseConfig).getSignedDownloadUrl("results/abc", 600, "foto-procesado.png"),
    );
    expect(url.searchParams.get("response-content-disposition")).toBe(
      contentDisposition("foto-procesado.png"),
    );
  });

  it("sin nombre de descarga no fuerza attachment", async () => {
    const url = new URL(await storageFor(baseConfig).getSignedDownloadUrl("results/abc", 600));
    expect(url.searchParams.has("response-content-disposition")).toBe(false);
  });

  it("incluye la expiración pedida en la firma", async () => {
    const url = new URL(await storageFor(baseConfig).getSignedDownloadUrl("results/abc", 600));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
  });

  it("sin endpoint público, firma con el endpoint del SDK", async () => {
    const url = new URL(
      await storageFor({ ...baseConfig, publicEndpoint: undefined }).getSignedDownloadUrl(
        "results/abc",
        60,
      ),
    );
    expect(url.host).toBe("localstack:4566");
  });

  it("sin endpoint custom (AWS real), usa el endpoint estándar de S3", async () => {
    const url = new URL(
      await storageFor({
        ...baseConfig,
        endpoint: undefined,
        publicEndpoint: undefined,
        forcePathStyle: false,
      }).getSignedDownloadUrl("results/abc", 60),
    );
    expect(url.host).toBe("images-bucket.s3.us-east-1.amazonaws.com");
  });
});

describe("contentDisposition", () => {
  it("usa attachment con el nombre tal cual si es ASCII", () => {
    expect(contentDisposition("foto.png")).toBe(
      `attachment; filename="foto.png"; filename*=UTF-8''foto.png`,
    );
  });

  it("reemplaza no-ASCII y comillas en el respaldo y codifica filename*", () => {
    const value = contentDisposition('año "1".png');
    expect(value).toContain('filename="a_o _1_.png"');
    expect(value).toContain("filename*=UTF-8''a%C3%B1o%20%221%22.png");
  });
});
