import type { Job } from "@app/types";
import { JobStatus } from "@app/types";
import type { Db } from "./db.js";

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

/**
 * Acceso a datos que necesita el worker: leer un job y moverlo de estado.
 * Interfaz para inyectar un doble en tests.
 */
export interface WorkerJobsRepository {
  findById(id: string): Promise<Job | null>;
  markProcessing(id: string): Promise<void>;
  markDone(id: string, s3KeyResult: string): Promise<void>;
  markError(id: string, errorMessage: string): Promise<void>;
}

export class PgWorkerJobsRepository implements WorkerJobsRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Job | null> {
    const { rows } = await this.db.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [id]);
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  async markProcessing(id: string): Promise<void> {
    await this.db.query(`UPDATE jobs SET status = $1 WHERE id = $2`, [JobStatus.Processing, id]);
  }

  async markDone(id: string, s3KeyResult: string): Promise<void> {
    await this.db.query(
      `UPDATE jobs SET status = $1, s3_key_result = $2, error_message = NULL WHERE id = $3`,
      [JobStatus.Done, s3KeyResult, id],
    );
  }

  async markError(id: string, errorMessage: string): Promise<void> {
    await this.db.query(`UPDATE jobs SET status = $1, error_message = $2 WHERE id = $3`, [
      JobStatus.Error,
      errorMessage,
      id,
    ]);
  }
}
