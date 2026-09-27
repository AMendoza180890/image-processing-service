import { randomUUID } from "node:crypto";
import type { Job } from "@app/types";
import { JobStatus } from "@app/types";
import type { Db } from "../db.js";

/** Fila cruda de la tabla `jobs` (snake_case, como viene de Postgres). */
interface JobRow {
  id: string;
  original_filename: string;
  s3_key_original: string;
  s3_key_result: string | null;
  status: JobStatus;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    originalFilename: row.original_filename,
    s3KeyOriginal: row.s3_key_original,
    s3KeyResult: row.s3_key_result,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CreateJobInput {
  originalFilename: string;
}

/**
 * Acceso a datos de la entidad Job. La interfaz permite mockearla en tests de rutas.
 */
export interface JobsRepository {
  create(input: CreateJobInput): Promise<Job>;
  findById(id: string): Promise<Job | null>;
  list(limit: number, offset: number): Promise<{ jobs: Job[]; total: number }>;
}

export class PgJobsRepository implements JobsRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateJobInput): Promise<Job> {
    // El id se genera acá para poder derivar la key de S3 (Fase 2) de forma estable.
    const id = randomUUID();
    const s3KeyOriginal = `originals/${id}`;
    const { rows } = await this.db.query<JobRow>(
      `INSERT INTO jobs (id, original_filename, s3_key_original, status)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, input.originalFilename, s3KeyOriginal, JobStatus.Pending],
    );
    return rowToJob(rows[0]!);
  }

  async findById(id: string): Promise<Job | null> {
    const { rows } = await this.db.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [id]);
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async list(limit: number, offset: number): Promise<{ jobs: Job[]; total: number }> {
    const [listResult, countResult] = await Promise.all([
      this.db.query<JobRow>(`SELECT * FROM jobs ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [
        limit,
        offset,
      ]),
      this.db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM jobs`),
    ]);
    return {
      jobs: listResult.rows.map(rowToJob),
      total: Number(countResult.rows[0]!.count),
    };
  }
}
