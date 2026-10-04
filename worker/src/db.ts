import pg from "pg";

const { Pool } = pg;

/** Crea un pool de conexiones a Postgres. */
export function createPool(databaseUrl: string): pg.Pool {
  return new Pool({ connectionString: databaseUrl });
}

export type Db = pg.Pool;
