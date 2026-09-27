// Vitest workspace: descubre los proyectos de cada paquete.
// Se van sumando `api` y `worker` a medida que se crean (Fase 1 y Fase 2).
import { defineWorkspace } from "vitest/config";

export default defineWorkspace(["packages/*", "api"]);
