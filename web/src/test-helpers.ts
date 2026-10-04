import { JobStatus, type Job } from "@app/types";
import type { ApiClient } from "./api";

let counter = 0;

/** Job válido según `jobSchema`, con overrides. */
export function makeJob(overrides: Partial<Job> = {}): Job {
  counter += 1;
  const id = `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  const now = new Date().toISOString();
  return {
    id,
    originalFilename: `foto-${counter}.png`,
    s3KeyOriginal: `originals/${id}`,
    s3KeyResult: null,
    status: JobStatus.Pending,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Cliente en memoria: cada `listJobs` devuelve el siguiente snapshot (el último se repite). */
export class FakeApiClient implements ApiClient {
  listCalls = 0;
  created: File[] = [];
  createError: Error | null = null;
  downloadUrl = "http://localhost:4566/images-bucket/results/x?sig=1";

  constructor(private snapshots: Job[][] = [[]]) {}

  setSnapshots(snapshots: Job[][]) {
    this.snapshots = snapshots;
    this.listCalls = 0;
  }

  async listJobs() {
    const jobs = this.snapshots[Math.min(this.listCalls, this.snapshots.length - 1)] ?? [];
    this.listCalls += 1;
    return { jobs, total: jobs.length, limit: 20, offset: 0 };
  }

  async getJob(id: string) {
    const job = this.snapshots.flat().find((j) => j.id === id);
    if (!job) throw new Error("not found");
    return job;
  }

  async createJob(file: File) {
    if (this.createError) throw this.createError;
    this.created.push(file);
    return makeJob({ originalFilename: file.name });
  }

  async getDownloadUrl() {
    return { url: this.downloadUrl, expiresInSeconds: 900 };
  }
}

export function imageFile(name = "foto.png", type = "image/png", size = 16): File {
  return new File([new Uint8Array(size)], name, { type });
}
