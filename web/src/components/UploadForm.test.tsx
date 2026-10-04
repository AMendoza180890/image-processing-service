import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UploadForm, validateFile } from "./UploadForm";
import { imageFile } from "../test-helpers";

function setup(onUpload = vi.fn(async () => {}), maxUploadBytes?: number) {
  // applyAccept: false → el test puede elegir archivos que el `accept` del input filtraría.
  const user = userEvent.setup({ applyAccept: false });
  render(<UploadForm onUpload={onUpload} maxUploadBytes={maxUploadBytes} />);
  const input = screen.getByLabelText("Imagen") as HTMLInputElement;
  const submit = screen.getByRole("button", { name: "Procesar" });
  return { user, input, submit, onUpload };
}

describe("UploadForm", () => {
  it("el botón está deshabilitado hasta elegir un archivo", () => {
    const { submit } = setup();
    expect(submit).toBeDisabled();
  });

  it("restringe el selector a los tipos de imagen aceptados", () => {
    const { input } = setup();
    expect(input.accept).toBe("image/png,image/jpeg,image/webp,image/gif");
  });

  it("sube el archivo elegido y limpia el formulario", async () => {
    const { user, input, submit, onUpload } = setup();
    const file = imageFile("foto.png");
    await user.upload(input, file);
    expect(submit).toBeEnabled();

    await user.click(submit);

    expect(onUpload).toHaveBeenCalledWith(file);
    await waitFor(() => expect(input.value).toBe(""));
    expect(screen.getByRole("button", { name: "Procesar" })).toBeDisabled();
  });

  it("rechaza en el navegador un archivo que no es imagen, sin subirlo", async () => {
    const { user, input, submit, onUpload } = setup();
    await user.upload(input, imageFile("nota.txt", "text/plain"));
    expect(screen.getByRole("alert")).toHaveTextContent("Formato no soportado");
    expect(submit).toBeDisabled();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it("rechaza un archivo mayor al límite", async () => {
    const { user, input, submit } = setup(undefined, 10);
    await user.upload(input, imageFile("grande.png", "image/png", 11));
    expect(screen.getByRole("alert")).toHaveTextContent("supera el máximo");
    expect(submit).toBeDisabled();
  });

  it("muestra el error de la API si la subida falla y permite reintentar", async () => {
    const onUpload = vi.fn(async () => {
      throw new Error("El archivo supera el tamaño máximo permitido");
    });
    const { user, input, submit } = setup(onUpload);
    await user.upload(input, imageFile());
    await user.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent("tamaño máximo");
    // El archivo sigue elegido: el error de la API no bloquea el reintento.
    expect(input.files).toHaveLength(1);
  });

  // Regresión: un error de la API no debe deshabilitar el botón como uno de validación; si no,
  // reintentar exigiría elegir otro archivo (elegir el mismo no dispara `change`).
  it("tras un error de la API se puede reintentar con el mismo archivo", async () => {
    let calls = 0;
    const onUpload = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("No se pudo conectar con la API");
    });
    const { user, input } = setup(onUpload);
    await user.upload(input, imageFile());
    await user.click(screen.getByRole("button", { name: "Procesar" }));
    await screen.findByRole("alert");

    const retry = screen.getByRole("button", { name: "Procesar" });
    expect(retry).toBeEnabled();
    await user.click(retry);
    expect(onUpload).toHaveBeenCalledTimes(2);
  });

  it("deshabilita el botón mientras sube", async () => {
    let resolve!: () => void;
    const onUpload = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const { user, input, submit } = setup(onUpload);
    await user.upload(input, imageFile());
    await user.click(submit);

    expect(screen.getByRole("button", { name: "Subiendo…" })).toBeDisabled();
    resolve();
    await screen.findByRole("button", { name: "Procesar" });
  });
});

describe("validateFile", () => {
  it("acepta cada tipo de imagen soportado dentro del límite", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(validateFile(imageFile("x", type, 5), 10)).toBeNull();
    }
  });

  it("acepta un archivo exactamente en el límite", () => {
    expect(validateFile(imageFile("x.png", "image/png", 10), 10)).toBeNull();
  });
});
