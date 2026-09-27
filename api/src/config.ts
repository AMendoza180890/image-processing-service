/**
 * Configuración de la API leída del entorno.
 * Falla temprano (fail-fast) si falta algo esencial.
 */
export interface ApiConfig {
  port: number;
  databaseUrl: string;
  corsOrigin: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Falta la variable de entorno requerida: ${name}`);
  }
  return value;
}

export function loadConfig(): ApiConfig {
  return {
    port: Number(process.env.API_PORT ?? 3000),
    databaseUrl: required("DATABASE_URL"),
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
  };
}
