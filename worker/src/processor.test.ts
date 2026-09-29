import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processImage } from "./processor.js";

/** Genera una imagen PNG sólida de prueba del ancho/alto dado. */
async function makeImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 100, g: 150, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

describe("processImage", () => {
  it("redimensiona al ancho del thumbnail y devuelve PNG válido", async () => {
    const input = await makeImage(800, 600);
    const { body, contentType } = await processImage(input, {
      thumbnailWidth: 320,
      watermarkText: "procesado",
    });

    expect(contentType).toBe("image/png");
    const meta = await sharp(body).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(320);
    // Mantiene proporción 4:3.
    expect(meta.height).toBe(240);
  });

  it("no agranda imágenes más chicas que el ancho objetivo", async () => {
    const input = await makeImage(100, 100);
    const { body } = await processImage(input, { thumbnailWidth: 320, watermarkText: "x" });
    const meta = await sharp(body).metadata();
    expect(meta.width).toBe(100);
  });

  it("superpone la marca de agua abajo a la derecha y deja intacto el resto", async () => {
    const input = await makeImage(800, 600);
    const { body } = await processImage(input, {
      thumbnailWidth: 320,
      watermarkText: "procesado",
    });
    const { data, info } = await sharp(body)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const bg = [100, 150, 200];

    // Esquina superior izquierda: sin marca de agua.
    expect(pixel(5, 5)).toEqual(bg);

    // Cuadrante inferior derecho: algún píxel debe diferir del fondo (el texto).
    let changed = 0;
    for (let y = Math.floor(info.height / 2); y < info.height; y++) {
      for (let x = Math.floor(info.width / 2); x < info.width; x++) {
        const [r, g, b] = pixel(x, y);
        if (r !== bg[0] || g !== bg[1] || b !== bg[2]) changed++;
      }
    }
    expect(changed).toBeGreaterThan(50);
  });

  it("escapa el texto de la marca de agua (caracteres XML no rompen el SVG)", async () => {
    const input = await makeImage(200, 100);
    const { body } = await processImage(input, {
      thumbnailWidth: 200,
      watermarkText: `<b>"A&B"</b> 'x'`,
    });
    const meta = await sharp(body).metadata();
    expect(meta.width).toBe(200);
  });

  it("rechaza un buffer que no es una imagen", async () => {
    const garbage = Buffer.from("esto no es una imagen");
    await expect(
      processImage(garbage, { thumbnailWidth: 320, watermarkText: "x" }),
    ).rejects.toThrow();
  });
});
