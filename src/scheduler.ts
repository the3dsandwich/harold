import cron from 'node-cron';
import * as jobs from './jobs/index.js';
import { send } from './lib/telegram.js';
import { humanize } from './lib/gemini.js';
import { logger } from './lib/logger.js';
import type { Job } from './types.js';

export function formatError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    if (current.message) parts.push(current.message);
    current = (current as Error & { cause?: unknown }).cause;
  }
  return parts.length > 0 ? parts.join(': ') : String(err);
}

/** Returns the text that was sent, or null if the job failed. */
export async function dispatch(job: Job): Promise<string | null> {
  logger.info('scheduler', `${job.id} fired`);
  try {
    const result = await job.execute();

    const text =
      result.summarize?.enabled
        ? await humanize(result.content, result.summarize.prompt)
        : result.content;

    await send(text);
    logger.info('scheduler', `${job.id} sent | ${text.length} chars`);
    return text;
  } catch (err) {
    logger.error('scheduler', `${job.id} failed: ${formatError(err)}`);
    return null;
  }
}

export function start(): void {
  const allJobs = Object.values(jobs);

  for (const job of allJobs) {
    if (!job.enabled) {
      logger.warn('scheduler', `${job.id} is disabled — skipping`);
      continue;
    }

    const timezone = job.timezone ?? process.env.TZ ?? 'UTC';

    cron.schedule(
      job.schedule,
      () => { void dispatch(job); },
      { timezone },
    );

    logger.info('scheduler', `${job.id} registered | schedule: ${job.schedule}`);
  }
}
