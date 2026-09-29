import { useRef, useState, type FormEvent } from "react";
import { ACCEPTED_IMAGE_MIME_TYPES, acceptedImageMimeTypeSchema } from "@app/types";

export interface UploadFormProps {
  onUpload: (file: File) => Promise<void>;
  /** Mismo límite que MAX_UPLOAD_MB de la API: se valida antes de subir. */
  maxUploadBytes?: number;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

/** Valida el archivo en el navegador; la API vuelve a validar (415/413) igualmente. */
export function validateFile(file: File, maxUploadBytes: number): string | null {
  if (!acceptedImageMimeTypeSchema.safeParse(file.type).success) {
    return "Formato no soportado: subí una imagen PNG, JPEG, WebP o GIF";
  }
  if (file.size > maxUploadBytes) {
    const mb = Math.round(maxUploadBytes / 1024 / 1024);
    return `El archivo supera el máximo de ${mb} MB`;
  }
  return null;
}

export function UploadForm({ onUpload, maxUploadBytes = DEFAULT_MAX_BYTES }: UploadFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  // Separados a propósito: un archivo inválido bloquea el envío; un fallo de la API
  // (red, 5xx) no, así se puede reintentar con el mismo archivo.
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const error = validationError ?? uploadError;

  function pick(next: File | null) {
    setFile(next);
    setValidationError(next ? validateFile(next, maxUploadBytes) : null);
    setUploadError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || validationError) return;
    setUploading(true);
    setUploadError(null);
    try {
      await onUpload(file);
      pick(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className="upload" onSubmit={submit} aria-label="Subir imagen">
      <label className="upload__picker">
        <span>Imagen</span>
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept={ACCEPTED_IMAGE_MIME_TYPES.join(",")}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          disabled={uploading}
        />
      </label>
      <button type="submit" disabled={!file || !!validationError || uploading}>
        {uploading ? "Subiendo…" : "Procesar"}
      </button>
      {error && (
        <p role="alert" className="upload__error">
          {error}
        </p>
      )}
    </form>
  );
}
