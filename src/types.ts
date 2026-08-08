/**
 * The contract every Harold script must implement.
 * Create a file in src/jobs/, implement this interface, export it,
 * and register it in src/jobs/index.ts.
 */
export interface Job {
  /** Unique kebab-case identifier shown in logs */
  id: string;
  /** Human-readable description of what this job does */
  description: string;
  /** Cron expression — e.g. "0 7 * * *" = daily at 7am */
  schedule: string;
  /** IANA timezone override. Defaults to process.env.TZ */
  timezone?: string;
  /** Set to false to skip registration without deleting the job */
  enabled: boolean;
  /** Run the job's logic and return a result ready for delivery */
  execute(ctx: JobContext): Promise<JobResult>;
}

/** One past run of a job, as persisted by the scheduler after a successful send. */
export interface JobHistoryEntry {
  /** Calendar date the job ran, in the job's own timezone (YYYY-MM-DD) */
  date: string;
  /** The message that was actually sent (post-humanization, if any) */
  content: string;
  /** Whatever the job chose to remember about this run, for its own future reference */
  metadata?: Record<string, unknown>;
}

/**
 * Passed to execute() so a job can see its own past runs — e.g. to avoid
 * repeating a notification, or to derive a trend from previously stored metadata.
 * A job never sees another job's history.
 */
export interface JobContext {
  /** This job's past runs, oldest first, capped by retention (see src/lib/state.ts) */
  history: JobHistoryEntry[];
}

/**
 * What a job returns from execute().
 *
 * Two shapes:
 *   - Direct: { content } — message is sent as-is, no LLM involved.
 *   - Summarized: { summarize } — Harold attempts Gemini humanization.
 *     If Gemini fails for any reason, summarize.fallback is sent instead.
 */
export type JobResult = (
  | {
      /** Message delivered directly to Telegram. */
      content: string;
    }
  | {
      summarize: {
        /** Raw data passed to Gemini as the user message. */
        content: string;
        /** System prompt describing Harold's voice and intent. */
        prompt: string;
        /** Delivered as-is when Gemini is unavailable or errors. */
        fallback: string;
      };
    }
) & {
  /** Persisted to this job's history after a successful send, for next run's ctx.history. */
  metadata?: Record<string, unknown>;
};
