import { readFile } from "node:fs/promises";
import { test, expect, type ConsoleMessage } from "@playwright/test";
import { isPng, pngWidth, solidPng } from "./png";

test("subir una imagen → esperar Listo → descargar el thumbnail", async ({ page }) => {
  // La validación de CORS del plan: ningún error en la consola del navegador.
  const consoleErrors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Procesador de imágenes" })).toBeVisible();

  const filename = `e2e-${Date.now()}.png`;
  await page.getByLabel("Imagen").setInputFiles({
    name: filename,
    mimeType: "image/png",
    buffer: solidPng(640, 480),
  });
  await page.getByRole("button", { name: "Procesar" }).click();

  const row = page.getByRole("listitem").filter({ hasText: filename });
  await expect(row).toBeVisible();
  // El polling del front refleja pending → processing → done.
  await expect(row.locator(".badge")).toHaveText("Listo", { timeout: 60_000 });

  const downloadPromise = page.waitForEvent("download");
  await row.getByRole("button", { name: "Descargar" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(filename.replace(/\.png$/, "-procesado.png"));
  const bytes = await readFile((await download.path())!);
  expect(isPng(bytes)).toBe(true);
  expect(pngWidth(bytes)).toBeLessThan(640);

  expect(consoleErrors).toEqual([]);
});

test("un archivo que no es imagen se rechaza antes de subir", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Imagen").setInputFiles({
    name: "nota.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hola"),
  });
  await expect(page.getByRole("alert")).toContainText("Formato no soportado");
  await expect(page.getByRole("button", { name: "Procesar" })).toBeDisabled();
});

test("la SPA responde en rutas profundas (fallback de Nginx)", async ({ page }) => {
  const res = await page.goto("/cualquier/ruta");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Procesador de imágenes" })).toBeVisible();
});
