import { useState } from "react";
import type { Job } from "@app/types";
import type { ApiClient } from "./api";
import { useJobs } from "./useJobs";
import { UploadForm } from "./components/UploadForm";
import { JobList } from "./components/JobList";

export interface AppProps {
  client: ApiClient;
  pollIntervalMs?: number;
  /** Límite de subida (bytes); debe coincidir con MAX_UPLOAD_MB de la API. */
  maxUploadBytes?: number;
  /** Abre la URL prefirmada. S3 responde `attachment`, así que descarga sin salir de la app. */
  navigate?: (url: string) => void;
}

export function App({
  client,
  pollIntervalMs,
  maxUploadBytes,
  navigate = (url) => window.location.assign(url),
}: AppProps) {
  const { jobs, loading, error, refresh } = useJobs(client, pollIntervalMs);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function upload(file: File) {
    await client.createJob(file);
    await refresh();
  }

  async function download(job: Job) {
    setDownloadingId(job.id);
    setDownloadError(null);
    try {
      const { url } = await client.getDownloadUrl(job.id);
      navigate(url);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <main className="app">
      <header>
        <h1>Procesador de imágenes</h1>
        <p>Subí una imagen y generamos un thumbnail con marca de agua.</p>
      </header>
      <UploadForm onUpload={upload} maxUploadBytes={maxUploadBytes} />
      <section>
        <h2>Trabajos</h2>
        {(error ?? downloadError) && (
          <p role="alert" className="banner">
            {error ?? downloadError}
          </p>
        )}
        {loading ? (
          <p>Cargando…</p>
        ) : error && jobs.length === 0 ? null : (
          // Si la lista no se pudo cargar, el aviso de error basta: "no hay jobs" sería falso.
          <JobList jobs={jobs} onDownload={download} downloadingId={downloadingId} />
        )}
      </section>
    </main>
  );
}
