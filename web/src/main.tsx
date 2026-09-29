import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createApiClient } from "./api";
import "./styles.css";

// Base relativa: Nginx (contenedor) y Vite (dev) reenvían `/api` a la API.
const client = createApiClient(import.meta.env.VITE_API_URL ?? "/api");
// Se fija en el build (arg VITE_MAX_UPLOAD_MB del Dockerfile, = MAX_UPLOAD_MB del compose).
const maxUploadBytes = Number(import.meta.env.VITE_MAX_UPLOAD_MB ?? 10) * 1024 * 1024;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App client={client} maxUploadBytes={maxUploadBytes} />
  </StrictMode>,
);
