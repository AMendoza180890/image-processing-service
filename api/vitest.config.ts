import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Los tests de integración con Testcontainers pueden tardar en levantar Postgres.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    include: ["src/**/*.test.ts"],
  },
});
