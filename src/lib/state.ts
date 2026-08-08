import fs from 'node:fs';
import path from 'node:path';
import type { JobHistoryEntry } from '../types.js';

const DEFAULT_MAX_ENTRIES = 400;

export function stateDir(): string {
  return process.env.STATE_DIR ?? '/data/state';
}

export function loadJobHistory(dir: string, jobId: string): JobHistoryEntry[] {
  const file = path.join(dir, `${jobId}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as JobHistoryEntry[];
}

/** Upserts `entry` by date (idempotent on same-day reruns), trims to the most recent `maxEntries`, and persists. */
export function appendJobHistory(
  dir: string,
  jobId: string,
  entry: JobHistoryEntry,
  maxEntries = DEFAULT_MAX_ENTRIES,
): JobHistoryEntry[] {
  const existing = loadJobHistory(dir, jobId).filter((e) => e.date !== entry.date);
  existing.push(entry);
  existing.sort((a, b) => a.date.localeCompare(b.date));
  const trimmed = existing.slice(-maxEntries);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${jobId}.json`), JSON.stringify(trimmed));

  return trimmed;
}
