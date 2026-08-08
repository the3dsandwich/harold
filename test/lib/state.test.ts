import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadJobHistory, appendJobHistory } from '../../src/lib/state.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harold-state-test-'));
}

describe('loadJobHistory', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('returns an empty array when no history file exists', () => {
    expect(loadJobHistory(dir, 'some-job')).toEqual([]);
  });

  it('reads back previously written entries', () => {
    appendJobHistory(dir, 'some-job', { date: '2026-08-08', content: 'hello' });
    expect(loadJobHistory(dir, 'some-job')).toEqual([{ date: '2026-08-08', content: 'hello' }]);
  });
});

describe('appendJobHistory', () => {
  let dir: string;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates the state directory if it does not exist', () => {
    const nested = path.join(dir, 'nested', 'state');
    appendJobHistory(nested, 'some-job', { date: '2026-08-08', content: 'hi' });
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('appends a new entry to existing history', () => {
    appendJobHistory(dir, 'some-job', { date: '2026-08-07', content: 'day 1' });
    appendJobHistory(dir, 'some-job', { date: '2026-08-08', content: 'day 2' });
    expect(loadJobHistory(dir, 'some-job')).toEqual([
      { date: '2026-08-07', content: 'day 1' },
      { date: '2026-08-08', content: 'day 2' },
    ]);
  });

  it('overwrites an existing entry for the same date instead of duplicating', () => {
    appendJobHistory(dir, 'some-job', { date: '2026-08-08', content: 'first run' });
    appendJobHistory(dir, 'some-job', { date: '2026-08-08', content: 'rerun' });
    expect(loadJobHistory(dir, 'some-job')).toEqual([{ date: '2026-08-08', content: 'rerun' }]);
  });

  it('keeps entries sorted ascending by date regardless of write order', () => {
    appendJobHistory(dir, 'some-job', { date: '2026-08-08', content: 'later' });
    appendJobHistory(dir, 'some-job', { date: '2026-08-01', content: 'earlier' });
    const history = loadJobHistory(dir, 'some-job');
    expect(history.map((e) => e.date)).toEqual(['2026-08-01', '2026-08-08']);
  });

  it('keeps job histories separate by job id', () => {
    appendJobHistory(dir, 'job-a', { date: '2026-08-08', content: 'a' });
    appendJobHistory(dir, 'job-b', { date: '2026-08-08', content: 'b' });
    expect(loadJobHistory(dir, 'job-a')).toEqual([{ date: '2026-08-08', content: 'a' }]);
    expect(loadJobHistory(dir, 'job-b')).toEqual([{ date: '2026-08-08', content: 'b' }]);
  });

  it('trims to the most recent maxEntries when exceeding the cap', () => {
    for (let i = 1; i <= 5; i++) {
      appendJobHistory(dir, 'some-job', { date: `2026-08-0${i}`, content: `day ${i}` }, 3);
    }
    const history = loadJobHistory(dir, 'some-job');
    expect(history.map((e) => e.date)).toEqual(['2026-08-03', '2026-08-04', '2026-08-05']);
  });

  it('preserves optional metadata', () => {
    appendJobHistory(dir, 'some-job', { date: '2026-08-08', content: 'x', metadata: { flagged: ['A'] } });
    expect(loadJobHistory(dir, 'some-job')).toEqual([
      { date: '2026-08-08', content: 'x', metadata: { flagged: ['A'] } },
    ]);
  });
});
