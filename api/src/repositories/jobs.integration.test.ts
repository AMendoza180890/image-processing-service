import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import runner from "node-pg-migrate";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createPool, type Db } from "../db.js";
import { PgJobsRepository } from "./jobs.js";

// Estos tests levantan Postgres REAL vía Docker. Requieren Docker corriendo.
// Se activan con DOCKER_TESTS=1 para no romper entornos sin Docker.
const runDocker = process.env.DOCKER_TESTS === "1";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../migrations",
);

describe.skipIf(!runDocker)("PgJobsRepository (integración)", () => {
  let container: StartedPostgreSqlContainer;
  let db: Db;
  let repo: PgJobsRepository;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16").start();
    const databaseUrl = container.getConnectionUri();
    await runner({
      databaseUrl,
      dir: migrationsDir,
      direction: "up",
      migrationsTable: "pgmigrations",
      count: Infinity,
    });
    db = createPool(databaseUrl);
    repo = new PgJobsRepository(db);
  });

  afterAll(async () => {
    await db?.end();
    await container?.stop();
  });

  it("create inserta un job pending con key derivada del id", async () => {
    const job = await repo.create({ originalFilename: "foto.png" });
    expect(job.status).toBe("pending");
    expect(job.s3KeyOriginal).toBe(`originals/${job.id}`);
    expect(job.errorMessage).toBeNull();
  });

  it("findById recupera el job creado y devuelve null si no existe", async () => {
    const created = await repo.create({ originalFilename: "otra.jpg" });
    const found = await repo.findById(created.id);
    expect(found?.id).toBe(created.id);
    expect(await repo.findById("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("markError pasa el job a error con su mensaje (satisface el CHECK de status)", async () => {
    const created = await repo.create({ originalFilename: "falla.png" });
    await repo.markError(created.id, "No se pudo encolar la imagen para procesarla");
    const found = await repo.findById(created.id);
    expect(found?.status).toBe("error");
    expect(found?.errorMessage).toBe("No se pudo encolar la imagen para procesarla");
  });

  it("list pagina y cuenta el total", async () => {
    const before = await repo.list(100, 0);
    await repo.create({ originalFilename: "x.png" });
    await repo.create({ originalFilename: "y.png" });
    const after = await repo.list(1, 0);
    expect(after.total).toBe(before.total + 2);
    expect(after.jobs).toHaveLength(1);
  });
});
