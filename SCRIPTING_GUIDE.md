# Harold Scripting Guide

Harold is a framework for scheduled personal notifications. Each notification is a **job** — a TypeScript module that runs static logic and optionally passes the result through an LLM to produce a natural-language Telegram message.

---

## For AI Agents — System Prompt

If you are using an AI assistant to generate a Harold script, paste this block as the system prompt:

```
You are writing a Harold job — a TypeScript module for a personal notification framework.

RULES:
1. Implement the Job interface exactly as defined below. Do not change field names or types.
2. execute(ctx) must contain all logic. It may call external APIs using fetch(). It must return a JobResult.
   ctx.history gives you this job's own past runs (date + what was sent + any metadata you stored last
   time) — use it if your job needs to remember something across days (e.g. "don't repeat this notification
   within a week"). If your job doesn't need memory, ignore ctx (or omit the parameter entirely — TypeScript
   allows an implementation to declare fewer parameters than the interface).
3. JobResult.content must be a plain text string — structured data, a summary, or a formatted snippet. This is the "raw" message.
4. If the message benefits from natural-language phrasing, return a `summarize` block instead of `content`, with a prompt that gives Harold a warm, friendly voice and explains the content format.
5. If the message is already readable as-is (e.g. a simple reminder), return `{ content }` directly — no LLM involved.
6. If your job wants to remember something for its own next run (e.g. which items it already flagged), set JobResult.metadata to a plain object. It gets persisted alongside today's entry and shows up in ctx.history on the next run — only this job sees it.
7. Use process.env for all secrets and configuration. Document every new env variable in .env.example format at the end of the file as a comment block.
8. Export the job as a named const (not default). The name should be camelCase.
9. Write a corresponding test file at test/jobs/<job-id>.test.ts. Mock fetch and any external modules. Test execute() logic, not the delivery pipeline.

INTERFACES (do not modify):

  interface Job {
    id: string;               // kebab-case
    description: string;
    schedule: string;         // cron expression
    timezone?: string;
    enabled: boolean;
    execute(ctx: JobContext): Promise<JobResult>;
  }

  interface JobHistoryEntry {
    date: string;              // YYYY-MM-DD, in the job's own timezone
    content: string;           // what was actually sent that day
    metadata?: Record<string, unknown>;
  }

  interface JobContext {
    history: JobHistoryEntry[]; // this job's own past runs, oldest first — never another job's
  }

  type JobResult = (
    | { content: string }                         // sent directly, no LLM
    | { summarize: {                              // try Gemini, fallback on failure
        content: string;    // input to Gemini
        prompt: string;     // system prompt
        fallback: string;   // sent if Gemini is unavailable
      }; }
  ) & {
    metadata?: Record<string, unknown>;  // persisted for next run's ctx.history, if you need it
  };

REGISTRATION (after generating the file):
  1. Add the file to src/jobs/<job-id>.ts
  2. Add one line to src/jobs/index.ts:
       export { myJob } from './<job-id>.js';
```

---

## Job Interface

```typescript
// src/types.ts
export interface Job {
  id: string;               // unique kebab-case — used in logs
  description: string;      // shown on startup
  schedule: string;         // cron expression, e.g. "0 7 * * *" = daily 7am
  timezone?: string;        // defaults to process.env.TZ
  enabled: boolean;         // set to false to pause without deleting
  execute(ctx: JobContext): Promise<JobResult>;
}

export interface JobHistoryEntry {
  date: string;              // YYYY-MM-DD, in the job's own timezone
  content: string;           // the message that was actually sent
  metadata?: Record<string, unknown>;
}

export interface JobContext {
  history: JobHistoryEntry[]; // this job's own past runs, oldest first
}

export type JobResult = (
  | { content: string }
  | { summarize: { content: string; prompt: string; fallback: string } }
) & {
  metadata?: Record<string, unknown>;
};
```

Most jobs don't need `ctx` at all — if your job's output only depends on today's data, you can declare
`execute(): Promise<JobResult>` with no parameter (see `morning-greeting.ts` and `currency-rates.ts`).
Only reach for `ctx.history` / `JobResult.metadata` when a job needs to
remember something across runs — see `fund-dip-watch.ts` for an example that tracks consecutive daily notifications
for each fund using successfully sent history.

---

## Annotated Example: `morning-greeting.ts`

```typescript
import type { Job, JobResult } from '../types.js';

// Pure helper — easy to unit test in isolation
export function describeWeatherCode(code: number): string {
  const map: Record<number, string> = { 0: 'clear sky', 1: 'mainly clear', /* ... */ };
  return map[code] ?? `unknown condition (code ${code})`;
}

export const morningGreeting: Job = {
  id: 'morning-greeting',          // kebab-case, unique
  description: 'Daily 7am weather greeting',
  schedule: '0 7 * * *',           // every day at 7:00am
  enabled: true,

  async execute(): Promise<JobResult> {
    // Read config from env — fall back to sensible defaults
    const lat = process.env.LATITUDE ?? '25.0330';
    const lon = process.env.LONGITUDE ?? '121.5654';

    // External API call — the only "side effect" in execute()
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode`);
    if (!response.ok) throw new Error(`Open-Meteo API error: ${response.status}`);

    const data = await response.json();
    const temp = Math.round(data.current.temperature_2m);
    const condition = describeWeatherCode(data.current.weathercode);

    return {
      // Structured but human-readable raw content
      content: `temperature: ${temp}°C, condition: ${condition}`,

      // Ask Harold (Gemini) to humanize it
      summarize: {
        enabled: true,
        prompt:
          'You are Harold, a friendly personal assistant. ' +
          'Write a warm good morning message (1-2 sentences) incorporating the weather.',
      },
    };
  },
};

// New env vars needed by this job — add these to .env.example:
// LATITUDE=25.0330
// LONGITUDE=121.5654
```

---

## Testing Pattern

```typescript
// test/jobs/morning-greeting.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { morningGreeting, describeWeatherCode } from '../../src/jobs/morning-greeting.js';

describe('describeWeatherCode', () => {
  it('returns known conditions', () => {
    expect(describeWeatherCode(0)).toBe('clear sky');
  });
  it('falls back for unknown codes', () => {
    expect(describeWeatherCode(999)).toBe('unknown condition (code 999)');
  });
});

describe('morningGreeting', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns formatted content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: { temperature_2m: 22.4, weathercode: 1 } }),
    }));

    const result = await morningGreeting.execute();
    expect(result.content).toBe('temperature: 22°C, condition: mainly clear');
    expect(result.summarize?.enabled).toBe(true);
  });

  it('throws on API error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(morningGreeting.execute()).rejects.toThrow('Open-Meteo API error: 503');
  });
});
```

---

## Adding a New Job — Checklist

1. **Create** `src/jobs/<job-id>.ts` — implement the `Job` interface
2. **Export** from `src/jobs/index.ts`:
   ```typescript
   export { myJob } from './<job-id>.js';
   ```
3. **Test** — create `test/jobs/<job-id>.test.ts` and run `npm test`
4. **Env vars** — if your job needs new secrets or config, add them to `.env.example` with comments
5. **Deploy** — `docker compose up --build` picks up the new job automatically

---

## Cron Expression Reference

| Expression    | Meaning                        |
|---------------|--------------------------------|
| `0 7 * * *`   | Every day at 7:00am            |
| `0 8 * * 1`   | Every Monday at 8:00am         |
| `0 9 1 * *`   | 1st of every month at 9:00am   |
| `30 12 * * 5` | Every Friday at 12:30pm        |
| `* * * * *`   | Every minute (useful for testing) |

All times are interpreted in the `TZ` environment variable (default: `Asia/Taipei`).

## Fund Dip Watch notifications

The daily 08:00 job reports up to three category-leading funds meeting the existing
-10% dip threshold, ordered by severity. Previously reported funds remain eligible
every day. Each entry reports consecutive calendar days in the notification, keyed
by fund ID and using the same TZ as scheduler history. A day without that fund in
a successfully sent notification resets its streak. Same-day reruns do not add a
day. Counts are carried in metadata so they can exceed the history retention size.

Legacy history contains category names rather than fund IDs, so per-fund streaks
start at one after this change. The pill-reminder job has been retired.
