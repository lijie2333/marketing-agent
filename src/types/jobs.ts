export type JobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "NEEDS_REVIEW";

export interface JobPrompt {
  content: string;
  script: string;
  direction: string;
  style: string;
  productionPhase: "SAMPLE" | "BULK" | null;
  productionBatch: {
    id: string;
    status: "SAMPLE_QUEUED" | "SAMPLE_RUNNING" | "SAMPLE_REVIEW" | "BULK_QUEUED" | "BULK_RUNNING" | "COMPLETED" | "FAILED";
  } | null;
}

export interface VideoJob {
  id: string;
  promptId: string;
  prompt: JobPrompt;
  status: JobStatus;
  workerId: string | null;
  resultUrl: string | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface JobStats {
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface JobsResponse {
  jobs: VideoJob[];
  stats: JobStats;
}
