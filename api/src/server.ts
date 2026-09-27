import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createPool(config.databaseUrl);
  const app = await buildApp({ db, corsOrigin: config.corsOrigin });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Recibida señal ${signal}, cerrando...`);
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  // host 0.0.0.0 es imprescindible dentro de contenedores.
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error("Fallo al iniciar la API:", err);
  process.exit(1);
});
