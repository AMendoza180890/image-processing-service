import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobStatus } from "@app/types";
import { App } from "./App";
import { ApiError } from "./api";
import { FakeApiClient, imageFile, makeJob } from "./test-helpers";

const POLL_MS = 20;

describe("App", () => {
  it("hace polling mientras hay jobs activos y se detiene al terminar", async () => {
    const job = makeJob({ status: JobStatus.Pending });
    const client = new FakeApiClient([
      [job],
      [{ ...job, status: JobStatus.Processing }],
      [{ ...job, status: JobStatus.Done, s3KeyResult: `results/${job.id}` }],
    ]);
    render(<App client={client} pollIntervalMs={POLL_MS} />);

    expect(await screen.findByText("Listo")).toBeInTheDocument();
    const callsWhenDone = client.listCalls;
    // Con todo terminado ya no se consulta más.
    await new Promise((r) => setTimeout(r, POLL_MS * 5));
    expect(client.listCalls).toBe(callsWhenDone);
  });

  it("no hace polling si no hay jobs activos", async () => {
    const client = new FakeApiClient([[makeJob({ status: JobStatus.Done, s3KeyResult: "r" })]]);
    render(<App client={client} pollIntervalMs={POLL_MS} />);
    await screen.findByText("Listo");
    await new Promise((r) => setTimeout(r, POLL_MS * 5));
    expect(client.listCalls).toBe(1);
  });

  it("subir una imagen refresca la lista y arranca el polling", async () => {
    const client = new FakeApiClient([[]]);
    render(<App client={client} pollIntervalMs={POLL_MS} />);
    await screen.findByText(/Todavía no subiste/);

    const uploaded = makeJob({ originalFilename: "gato.png", status: JobStatus.Pending });
    client.setSnapshots([
      [uploaded],
      [{ ...uploaded, status: JobStatus.Done, s3KeyResult: `results/${uploaded.id}` }],
    ]);

    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Imagen"), imageFile("gato.png"));
    await user.click(screen.getByRole("button", { name: "Procesar" }));

    expect(client.created.map((f) => f.name)).toEqual(["gato.png"]);
    expect(await screen.findByText("gato.png")).toBeInTheDocument();
    expect(await screen.findByText("Listo")).toBeInTheDocument();
  });

  // Regresión: si la carga inicial (pedida antes de subir) llega después del refresh post-subida,
  // no debe pisar la lista con un snapshot sin el job nuevo (el polling se apagaría y el job
  // no volvería a aparecer). useJobs descarta respuestas más viejas que la última aplicada.
  it("una respuesta vieja de la lista no pisa a una más nueva", async () => {
    const uploaded = makeJob({ originalFilename: "gato.png", status: JobStatus.Pending });
    const client = new FakeApiClient();
    let releaseInitial!: () => void;
    let calls = 0;
    client.listJobs = async () => {
      calls += 1;
      if (calls === 1) {
        await new Promise<void>((r) => (releaseInitial = r));
        return { jobs: [], total: 0, limit: 20, offset: 0 };
      }
      return { jobs: [uploaded], total: 1, limit: 20, offset: 0 };
    };
    render(<App client={client} pollIntervalMs={POLL_MS} />);

    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Imagen"), imageFile("gato.png"));
    await user.click(screen.getByRole("button", { name: "Procesar" }));
    expect(await screen.findByText("gato.png")).toBeInTheDocument();

    // Llega tarde la respuesta de la carga inicial.
    releaseInitial();
    await new Promise((r) => setTimeout(r, POLL_MS * 5));
    expect(screen.getByText("gato.png")).toBeInTheDocument();
  });

  it("Descargar pide la URL prefirmada y la abre", async () => {
    const job = makeJob({ status: JobStatus.Done, s3KeyResult: "results/x" });
    const client = new FakeApiClient([[job]]);
    const navigate = vi.fn();
    render(<App client={client} navigate={navigate} />);

    await userEvent.click(await screen.findByRole("button", { name: "Descargar" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(client.downloadUrl));
  });

  it("muestra el error si la descarga falla", async () => {
    const job = makeJob({ status: JobStatus.Done, s3KeyResult: "results/x" });
    const client = new FakeApiClient([[job]]);
    client.getDownloadUrl = async () => {
      throw new ApiError(409, "El resultado todavía no está listo");
    };
    const navigate = vi.fn();
    render(<App client={client} navigate={navigate} />);

    await userEvent.click(await screen.findByRole("button", { name: "Descargar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("todavía no está listo");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("muestra un aviso si la API no responde", async () => {
    const client = new FakeApiClient();
    client.listJobs = async () => {
      throw new ApiError(0, "No se pudo conectar con la API");
    };
    render(<App client={client} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo conectar");
    // Sin datos no se puede afirmar que "no hay jobs".
    expect(screen.queryByText(/Todavía no subiste/)).toBeNull();
  });
});
