import sharp from "sharp";

export interface ProcessOptions {
  thumbnailWidth: number;
  watermarkText: string;
}

export interface ProcessResult {
  body: Buffer;
  contentType: string;
}

/** Escapa el texto para incrustarlo en el SVG de la marca de agua. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Genera el thumbnail (redimensiona a `thumbnailWidth`, sin agrandar) y superpone
 * una marca de agua de texto en la esquina inferior derecha. Devuelve PNG.
 *
 * Lanza si el buffer de entrada no es una imagen válida (sharp falla) — el caller
 * traduce eso a estado `error` del job.
 */
export async function processImage(input: Buffer, opts: ProcessOptions): Promise<ProcessResult> {
  // Redimensiona respetando orientación EXIF. `withoutEnlargement` evita escalar
  // imágenes más chicas que el ancho objetivo.
  const { data: thumb, info } = await sharp(input)
    .rotate()
    .resize({ width: opts.thumbnailWidth, withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });

  const fontSize = Math.max(12, Math.round(info.width / 12));
  const padding = Math.round(fontSize / 2);
  const text = escapeXml(opts.watermarkText);
  const svg = `<svg width="${info.width}" height="${info.height}" xmlns="http://www.w3.org/2000/svg">
    <text x="${info.width - padding}" y="${info.height - padding}"
      font-family="sans-serif" font-size="${fontSize}" fill="white"
      fill-opacity="0.85" stroke="black" stroke-width="1" stroke-opacity="0.4"
      text-anchor="end">${text}</text>
  </svg>`;

  const body = await sharp(thumb)
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();

  return { body, contentType: "image/png" };
}
