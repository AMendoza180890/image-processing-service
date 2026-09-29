import { useCallback, useEffect, useRef, useState } from "react";
import { JobStatus, type Job } from "@app/types";
import type { ApiClient } from "./api";

/** Un job sigue "vivo" (hay que seguir consultándolo) mientras no llegue a done/error. */
export function isActive(job: Job): boolean {
  return job.status === JobStatus.Pending || job.status === JobStatus.Processing;
}

export interface UseJobs {
  jobs: Job[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Lista de jobs con polling: consulta la API cada `pollIntervalMs` solo mientras haya
 * algún job pending/processing, y se detiene cuando todos terminan.
 *
 * Las respuestas pueden llegar desordenadas (una carga lenta vs. el refresh tras subir):
 * cada pedido lleva un número de secuencia y se descarta el que llega detrás de uno más nuevo.
 * El polling es una cadena de `setTimeout` (el siguiente se agenda al terminar el actual),
 * así nunca se acumulan pedidos si la API tarda más que el intervalo.
 */
export function useJobs(client: ApiClient, pollIntervalMs = 2000): UseJobs {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const lastIssued = useRef(0);
  const lastApplied = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++lastIssued.current;
    try {
      const { jobs: next } = await client.listJobs();
      if (!mounted.current || seq < lastApplied.current) return;
      lastApplied.current = seq;
      setJobs(next);
      setError(null);
    } catch (err) {
      if (!mounted.current || seq < lastApplied.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const polling = jobs.some(isActive);
  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      await refresh();
      if (!cancelled) timer = setTimeout(tick, pollIntervalMs);
    };
    timer = setTimeout(tick, pollIntervalMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [polling, pollIntervalMs, refresh]);

  return { jobs, loading, error, refresh };
}
