// Vitest workspace: descubre los proyectos de cada paquete.
import { defineWorkspace } from "vitest/config";

export default defineWorkspace(["packages/*", "api", "worker", "web"]);
