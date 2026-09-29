import { describe, it, expect, vi } from "vitest";
import { JobStatus } from "@app/types";
import { ApiError, createApiClient } from "./api";
import { imageFile, makeJob } from "./test-helpers";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createApiClient", () => {
  it("createJob envía multipart con el campo `file` y devuelve el job validado", async () => {
    const job = makeJob({ originalFilename: "foto.png" });
    const fetchMock = vi.fn(async () => jsonResponse({ job }, 201));
    const client = createApiClient("/api/", fetchMock as typeof fetch);

    const result = await client.createJob(imageFile("foto.png"));

    expect(result).toEqual(job);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/jobs");
    expect(init.method).toBe("POST");
    const sent = (init.body as FormData).get("file") as File;
    expect(sent.name).toBe("foto.png");
    expect(sent.type).toBe("image/png");
  });

  it("listJobs pasa la paginación en la query", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ jobs: [], total: 0, limit: 5, offset: 10 }));
    await createApiClient("/api", fetchMock as typeof fetch).listJobs(5, 10);
    expect(fetchMock).toHaveBeenCalledWith("/api/jobs?limit=5&offset=10", undefined);
  });

  it.each([
    [413, /tamaño máximo/],
    [415, /Formato no soportado/],
    [409, /no está listo/],
  ])("traduce %i a un ApiError legible", async (status, message) => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "x" }, status));
    const err = await createApiClient("/api", fetchMock as typeof fetch)
      .getDownloadUrl("id")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(status);
    expect((err as ApiError).message).toMatch(message);
  });

  it("usa `details` del cuerpo para errores sin mensaje propio", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "Bad Request", details: "Falta el archivo `file`" }, 400),
    );
    await expect(
      createApiClient("/api", fetchMock as typeof fetch).createJob(imageFile()),
    ).rejects.toThrow("Falta el archivo `file`");
  });

  it("un cuerpo no JSON (ej. 502 de Nginx) no rompe el manejo de errores", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>Bad Gateway</html>", { status: 502 }));
    await expect(createApiClient("/api", fetchMock as typeof fetch).listJobs()).rejects.toThrow(
      "Error 502 de la API",
    );
  });

  it("un fallo de red se reporta como ApiError status 0", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await createApiClient("/api", fetchMock as typeof fetch)
      .listJobs()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });

  it("rechaza respuestas que no cumplen el contrato de @app/types", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ job: { ...makeJob(), status: "desconocido" } }),
    );
    await expect(createApiClient("/api", fetchMock as typeof fetch).getJob("x")).rejects.toThrow();
  });

  it("getJob devuelve el job desenvuelto", async () => {
    const job = makeJob({ status: JobStatus.Done, s3KeyResult: "results/x" });
    const fetchMock = vi.fn(async () => jsonResponse({ job }));
    expect(await createApiClient("/api", fetchMock as typeof fetch).getJob(job.id)).toEqual(job);
  });
});
