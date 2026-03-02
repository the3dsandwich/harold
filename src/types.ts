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
  execute(): Promise<JobResult>;
}

export interface JobResult {
  /** Raw output from deterministic logic — the "meat" of the message */
  content: string;
  /**
   * When present and enabled, passes content through Gemini before sending.
   * Use this to turn structured data into a natural-language message.
   */
  summarize?: {
    enabled: boolean;
    /** System prompt given to Gemini. Should describe Harold's voice and intent. */
    prompt: string;
  };
}
