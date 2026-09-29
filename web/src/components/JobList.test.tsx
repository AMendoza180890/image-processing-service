import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobStatus } from "@app/types";
import { JobList } from "./JobList";
import { makeJob } from "../test-helpers";

describe("JobList", () => {
  it("muestra un mensaje cuando no hay jobs", () => {
    render(<JobList jobs={[]} onDownload={vi.fn()} />);
    expect(screen.getByText(/Todavía no subiste/)).toBeInTheDocument();
  });

  it("muestra cada estado con su etiqueta", () => {
    const jobs = [
      makeJob({ status: JobStatus.Pending }),
      makeJob({ status: JobStatus.Processing }),
      makeJob({ status: JobStatus.Done, s3KeyResult: "results/x" }),
      makeJob({
        status: JobStatus.Error,
        errorMessage: "Input buffer contains unsupported image format",
      }),
    ];
    render(<JobList jobs={jobs} onDownload={vi.fn()} />);
    const labels = screen
      .getAllByRole("listitem")
      .map((li) => li.querySelector(".badge")?.textContent);
    expect(labels).toEqual(["En cola", "Procesando", "Listo", "Error"]);
  });

  it("solo los jobs done tienen botón de descarga", () => {
    const pending = makeJob({ status: JobStatus.Pending });
    const done = makeJob({ status: JobStatus.Done, s3KeyResult: "results/x" });
    render(<JobList jobs={[pending, done]} onDownload={vi.fn()} />);
    expect(within(screen.getByTestId(`job-${pending.id}`)).queryByRole("button")).toBeNull();
    expect(
      within(screen.getByTestId(`job-${done.id}`)).getByRole("button", { name: "Descargar" }),
    ).toBeInTheDocument();
  });

  it("muestra el mensaje de error de un job fallido", () => {
    render(
      <JobList
        jobs={[makeJob({ status: JobStatus.Error, errorMessage: "imagen corrupta" })]}
        onDownload={vi.fn()}
      />,
    );
    expect(screen.getByText("imagen corrupta")).toBeInTheDocument();
  });

  it("al hacer click en Descargar avisa con el job", async () => {
    const done = makeJob({ status: JobStatus.Done, s3KeyResult: "results/x" });
    const onDownload = vi.fn();
    render(<JobList jobs={[done]} onDownload={onDownload} />);
    await userEvent.click(screen.getByRole("button", { name: "Descargar" }));
    expect(onDownload).toHaveBeenCalledWith(done);
  });

  it("deshabilita el botón del job que se está descargando", () => {
    const done = makeJob({ status: JobStatus.Done, s3KeyResult: "results/x" });
    render(<JobList jobs={[done]} onDownload={vi.fn()} downloadingId={done.id} />);
    expect(screen.getByRole("button", { name: "Descargar" })).toBeDisabled();
  });
});
