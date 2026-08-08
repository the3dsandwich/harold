import cron from 'node-cron';
import * as jobs from './jobs/index.js';
import { send } from './lib/telegram.js';
import { humanize } from './lib/gemini.js';
import { logger } from './lib/logger.js';
import { appendJobHistory, loadJobHistory, stateDir } from './lib/state.js';
import type { Job } from './types.js';

type NodeError = Error & { code?: string; cause?: unknown };

export function formatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    const e = current as NodeError;
    const label = e.message || e.code || e.constructor.name;
    if (label) parts.push(label);
    current = e.cause;
  }
  return parts.length > 0 ? parts.join(': ') : String(err);
}

/** Calendar date in the given IANA timezone, as YYYY-MM-DD. */
function todayIn(timezone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
}

/** Returns the text that was sent, or null if the job failed. */
export async function dispatch(job: Job): Promise<string | null> {
  logger.info('scheduler', `${job.id} fired`);
  const dir = stateDir();
  try {
    const history = loadJobHistory(dir, job.id);
    const result = await job.execute({ history });

    let text: string;
    if ('summarize' in result) {
      try {
        text = await humanize(result.summarize.content, result.summarize.prompt);
      } catch (err) {
        logger.warn('scheduler', `${job.id} Gemini failed, using fallback: ${formatError(err)}`);
        text = result.summarize.fallback;
      }
    } else {
      text = result.content;
    }

    await send(text);
    logger.info('scheduler', `${job.id} sent | ${text.length} chars`);

    const timezone = job.timezone ?? process.env.TZ ?? 'UTC';
    appendJobHistory(dir, job.id, {
      date: todayIn(timezone),
      content: text,
      metadata: result.metadata,
    });

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
