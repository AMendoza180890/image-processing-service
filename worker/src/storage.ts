import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

/**
 * Acceso a objetos en S3 desde el worker: descarga el original, sube el resultado.
 * Interfaz para inyectar un doble en tests.
 */
export interface ObjectStorage {
  getObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
}

export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async getObject(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) {
      throw new Error(`Objeto S3 sin cuerpo: ${key}`);
    }
    // El SDK v3 en Node expone un stream con helper para juntar bytes.
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }
}
