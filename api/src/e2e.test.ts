import { describe, it, expect } from "vitest";
import { crc32, deflateSync } from "node:zlib";
import { JobStatus, type Job } from "@app/types";

// e2e contra el stack de `docker compose up` (api + worker + LocalStack + Postgres).
// Se activa con E2E_BASE_URL, ej: E2E_BASE_URL=http://localhost:3000 pnpm --filter @app/api test
const baseUrl = process.env.E2E_BASE_URL;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([len, typeAndData, crc]);
}

/** PNG RGB de color sólido, sin depender de sharp en la API. */
function solidPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const row = Buffer.alloc(1 + width * 3); // byte de filtro 0 + píxeles
  for (let x = 0; x < width; x++) row.set([0x33, 0x66, 0xaa], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function waitForTerminal(jobId: string, timeoutMs: number): Promise<Job> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/jobs/${jobId}`);
    const { job } = (await res.json()) as { job: Job };
    if (job.status === JobStatus.Done || job.status === JobStatus.Error) return job;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`El job ${jobId} no terminó en ${timeoutMs} ms`);
}

describe.skipIf(!baseUrl)("e2e: subir → procesar → descargar", () => {
  it("el job llega a done y la URL prefirmada descarga un PNG thumbnail", async () => {
    const form = new FormData();
    form.append("file", new Blob([solidPng(640, 480)], { type: "image/png" }), "e2e.png");
    const created = await fetch(`${baseUrl}/jobs`, { method: "POST", body: form });
    expect(created.status).toBe(201);
    const { job } = (await created.json()) as { job: Job };

    const finished = await waitForTerminal(job.id, 60_000);
    expect(finished.errorMessage).toBeNull();
    expect(finished.status).toBe(JobStatus.Done);

    const dl = await fetch(`${baseUrl}/jobs/${job.id}/download`);
    expect(dl.status).toBe(200);
    const { url } = (await dl.json()) as { url: string };

    const file = await fetch(url);
    expect(file.status).toBe(200);
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    // IHDR: ancho en el offset 16. El worker redimensiona a THUMBNAIL_WIDTH (320 por defecto).
    const width = bytes.readUInt32BE(16);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThan(640);
  }, 90_000);

  it("una imagen corrupta termina en error y la descarga responde 409", async () => {
    const form = new FormData();
    form.append(
      "file",
      new Blob([Buffer.from("no soy un png")], { type: "image/png" }),
      "roto.png",
    );
    const created = await fetch(`${baseUrl}/jobs`, { method: "POST", body: form });
    expect(created.status).toBe(201);
    const { job } = (await created.json()) as { job: Job };

    const finished = await waitForTerminal(job.id, 60_000);
    expect(finished.status).toBe(JobStatus.Error);
    expect(finished.errorMessage).toBeTruthy();

    const dl = await fetch(`${baseUrl}/jobs/${job.id}/download`);
    expect(dl.status).toBe(409);
  }, 90_000);

  it("la API rechaza por HTTP un archivo que no es imagen (415)", async () => {
    const form = new FormData();
    form.append("file", new Blob(["hola"], { type: "text/plain" }), "nota.txt");
    const res = await fetch(`${baseUrl}/jobs`, { method: "POST", body: form });
    expect(res.status).toBe(415);
  });
});
