export enum JobStatus {
  PENDING = "pending",
  QUEUED = "queued",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
  RETRYING = "retrying",
}

export enum JobPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

export interface Job {
  id: string;
  title: string;
  description?: string;
  type: string;
  status: JobStatus;
  priority: JobPriority;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  data?: Record<string, unknown>;
  progress?: number;
  attempts?: number;
  max_attempts?: number;
  scheduled_at?: string;
  started_at?: string;
  completed_at?: string;
  failed_at?: string;
  error?: string;
  organization_id: string;
  created_at: string;
  updated_at: string;
}
