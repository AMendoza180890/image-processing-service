import { PutObjectCommand, GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Almacenamiento de objetos (S3). Es una interfaz para poder inyectar un doble
 * en los tests de rutas, igual que el `JobsRepository`.
 */
export interface ObjectStorage {
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  /**
   * URL prefirmada de descarga (GET) con expiración. Con `downloadFilename`, S3 responde con
   * `Content-Disposition: attachment` y el navegador descarga en vez de navegar.
   */
  getSignedDownloadUrl(
    key: string,
    expiresInSeconds: number,
    downloadFilename?: string,
  ): Promise<string>;
}

export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    /** Cliente para firmar URLs (endpoint público). Por defecto, `client`. */
    private readonly presignClient: S3Client = client,
  ) {}

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getSignedDownloadUrl(
    key: string,
    expiresInSeconds: number,
    downloadFilename?: string,
  ): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: downloadFilename
          ? contentDisposition(downloadFilename)
          : undefined,
      }),
      { expiresIn: expiresInSeconds },
    );
  }
}

/**
 * `attachment` con nombre ASCII de respaldo + `filename*` (RFC 6266/5987) para nombres
 * con acentos u otros caracteres no ASCII.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
