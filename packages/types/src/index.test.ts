import { describe, it, expect } from "vitest";
import {
  JobStatus,
  jobStatusSchema,
  jobSchema,
  listJobsQuerySchema,
  jobIdParamsSchema,
  jobMessageSchema,
  acceptedImageMimeTypeSchema,
} from "./index.js";

const validJob = {
  id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  originalFilename: "foto.png",
  s3KeyOriginal: "originals/3f2504e0.png",
  s3KeyResult: null,
  status: JobStatus.Pending,
  errorMessage: null,
  createdAt: "2026-09-27T12:00:00.000Z",
  updatedAt: "2026-09-27T12:00:00.000Z",
};

describe("jobStatusSchema", () => {
  it("acepta los cuatro estados válidos", () => {
    for (const s of ["pending", "processing", "done", "error"]) {
      expect(jobStatusSchema.parse(s)).toBe(s);
    }
  });

  it("rechaza un estado fuera del enum", () => {
    expect(() => jobStatusSchema.parse("cancelled")).toThrow();
  });
});

describe("jobSchema", () => {
  it("parsea un job válido", () => {
    expect(jobSchema.parse(validJob)).toEqual(validJob);
  });

  it("rechaza un id que no es uuid", () => {
    expect(() => jobSchema.parse({ ...validJob, id: "no-uuid" })).toThrow();
  });

  it("rechaza createdAt que no es ISO datetime", () => {
    expect(() => jobSchema.parse({ ...validJob, createdAt: "ayer" })).toThrow();
  });
});

describe("listJobsQuerySchema", () => {
  it("aplica defaults cuando faltan params", () => {
    expect(listJobsQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
  });

  it("coacciona strings de querystring a números", () => {
    expect(listJobsQuerySchema.parse({ limit: "5", offset: "10" })).toEqual({
      limit: 5,
      offset: 10,
    });
  });

  it("rechaza limit fuera de rango", () => {
    expect(() => listJobsQuerySchema.parse({ limit: "500" })).toThrow();
  });
});

describe("jobIdParamsSchema", () => {
  it("rechaza id inválido", () => {
    expect(() => jobIdParamsSchema.parse({ id: "123" })).toThrow();
  });
});

describe("jobMessageSchema", () => {
  it("valida el mensaje de cola", () => {
    expect(jobMessageSchema.parse({ jobId: validJob.id })).toEqual({ jobId: validJob.id });
  });
});

describe("acceptedImageMimeTypeSchema", () => {
  it("acepta los tipos de imagen soportados por el worker", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
      expect(acceptedImageMimeTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rechaza tipos que sharp no procesa o que no son imagen", () => {
    for (const type of ["image/svg+xml", "text/plain", "application/pdf", ""]) {
      expect(acceptedImageMimeTypeSchema.safeParse(type).success).toBe(false);
    }
  });
});
