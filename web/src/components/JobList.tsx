import { JobStatus, type Job } from "@app/types";

const STATUS_LABELS: Record<JobStatus, string> = {
  [JobStatus.Pending]: "En cola",
  [JobStatus.Processing]: "Procesando",
  [JobStatus.Done]: "Listo",
  [JobStatus.Error]: "Error",
};

export interface JobListProps {
  jobs: Job[];
  onDownload: (job: Job) => void;
  /** Id del job cuya descarga se está pidiendo (deshabilita su botón). */
  downloadingId?: string | null;
}

export function JobList({ jobs, onDownload, downloadingId }: JobListProps) {
  if (jobs.length === 0) {
    return <p className="empty">Todavía no subiste ninguna imagen.</p>;
  }
  return (
    <ul className="jobs" aria-label="Trabajos">
      {jobs.map((job) => (
        <li key={job.id} className="job" data-testid={`job-${job.id}`}>
          <span className="job__name" title={job.originalFilename}>
            {job.originalFilename}
          </span>
          <span className={`badge badge--${job.status}`} data-status={job.status}>
            {STATUS_LABELS[job.status]}
          </span>
          {job.status === JobStatus.Done && (
            <button
              type="button"
              onClick={() => onDownload(job)}
              disabled={downloadingId === job.id}
            >
              Descargar
            </button>
          )}
          {job.status === JobStatus.Error && job.errorMessage && (
            <span className="job__error">{job.errorMessage}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
