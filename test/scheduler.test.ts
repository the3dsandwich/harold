import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JobContext, JobHistoryEntry, JobResult } from '../src/types.js';

const scheduleMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const humanizeMock = vi.hoisted(() => vi.fn().mockResolvedValue('Humanized message'));
const executeMock = vi.hoisted(() => vi.fn<(ctx: JobContext) => Promise<JobResult>>());
const loadJobHistoryMock = vi.hoisted(() => vi.fn().mockReturnValue([]));
const appendJobHistoryMock = vi.hoisted(() => vi.fn());
const stateDirMock = vi.hoisted(() => vi.fn().mockReturnValue('/data/state'));

vi.mock('node-cron', () => ({ default: { schedule: scheduleMock } }));
vi.mock('../src/lib/telegram.js', () => ({ send: sendMock }));
vi.mock('../src/lib/gemini.js', () => ({ humanize: humanizeMock }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/lib/state.js', () => ({
  loadJobHistory: loadJobHistoryMock,
  appendJobHistory: appendJobHistoryMock,
  stateDir: stateDirMock,
}));
vi.mock('../src/jobs/index.js', () => ({
  enabledJob: {
    id: 'enabled-job',
    description: 'An enabled test job',
    schedule: '0 7 * * *',
    enabled: true,
    execute: executeMock,
  },
  disabledJob: {
    id: 'disabled-job',
    description: 'A disabled test job',
    schedule: '0 8 * * *',
    enabled: false,
    execute: vi.fn(),
  },
}));

import { start, dispatch, formatError } from '../src/scheduler.js';

const fakeJob = {
  id: 'fake-job',
  description: 'Fake job for dispatch tests',
  schedule: '0 7 * * *',
  timezone: 'UTC',
  enabled: true,
  execute: executeMock,
};

describe('formatError', () => {
  it('returns the message for a plain Error', () => {
    expect(formatError(new Error('something went wrong'))).toBe('something went wrong');
  });

  it('joins cause chain messages with colon separator, using constructor name for empty messages', () => {
    const root = new Error('root cause');
    const mid = new Error('');       // empty message → falls back to "Error"
    const top = new Error('fetch failed');
    (mid as Error & { cause: unknown }).cause = root;
    (top as Error & { cause: unknown }).cause = mid;
    expect(formatError(top)).toBe('fetch failed: Error: root cause');
  });

  it('falls back to error code when message is empty', () => {
    const inner = Object.assign(new Error(''), { code: 'ENOTFOUND' });
    const outer = new Error('fetch failed');
    (outer as Error & { cause: unknown }).cause = inner;
    expect(formatError(outer)).toBe('fetch failed: ENOTFOUND');
  });

  it('falls back to constructor name when message and code are both empty', () => {
    class ConnectTimeoutError extends Error {
      constructor() { super(''); }
    }
    const inner = new ConnectTimeoutError();
    const outer = new Error('fetch failed');
    (outer as Error & { cause: unknown }).cause = inner;
    expect(formatError(outer)).toBe('fetch failed: ConnectTimeoutError');
  });

  it('handles a single-level error with no cause', () => {
    expect(formatError(new Error('simple error'))).toBe('simple error');
  });

  it('handles non-Error values', () => {
    expect(formatError('a string error')).toBe('a string error');
    expect(formatError(42)).toBe('42');
  });
});

describe('dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadJobHistoryMock.mockReturnValue([]);
  });

  it('sends content directly when no summarize', async () => {
    executeMock.mockResolvedValue({ content: 'raw output' });
    await dispatch(fakeJob);
    expect(sendMock).toHaveBeenCalledWith('raw output');
    expect(humanizeMock).not.toHaveBeenCalled();
  });

  it('passes summarize.content through Gemini and sends result', async () => {
    executeMock.mockResolvedValue({
      summarize: { content: 'raw data', prompt: 'Be friendly', fallback: 'fallback msg' },
    });
    await dispatch(fakeJob);
    expect(humanizeMock).toHaveBeenCalledWith('raw data', 'Be friendly');
    expect(sendMock).toHaveBeenCalledWith('Humanized message');
  });

  it('sends fallback when Gemini fails', async () => {
    executeMock.mockResolvedValue({
      summarize: { content: 'raw data', prompt: 'Be friendly', fallback: 'fallback msg' },
    });
    humanizeMock.mockRejectedValue(new Error('503 Service Unavailable'));
    await dispatch(fakeJob);
    expect(sendMock).toHaveBeenCalledWith('fallback msg');
  });

  it('does not throw or send when job.execute() rejects', async () => {
    executeMock.mockRejectedValue(new Error('network error'));
    await expect(dispatch(fakeJob)).resolves.not.toThrow();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('does not throw when telegram.send() rejects', async () => {
    executeMock.mockResolvedValue({ content: 'raw output' });
    sendMock.mockRejectedValue(new Error('telegram down'));
    await expect(dispatch(fakeJob)).resolves.not.toThrow();
  });
});

describe('dispatch — job history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadJobHistoryMock.mockReturnValue([]);
    sendMock.mockResolvedValue(undefined);
    humanizeMock.mockResolvedValue('Humanized message');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes this job\'s own history from loadJobHistory into ctx.history', async () => {
    const priorHistory: JobHistoryEntry[] = [{ date: '2026-08-07', content: 'yesterday' }];
    loadJobHistoryMock.mockReturnValue(priorHistory);
    executeMock.mockResolvedValue({ content: 'raw output' });

    await dispatch(fakeJob);

    expect(loadJobHistoryMock).toHaveBeenCalledWith('/data/state', 'fake-job');
    expect(executeMock).toHaveBeenCalledWith({ history: priorHistory });
  });

  it('persists the sent content and metadata after a successful send', async () => {
    executeMock.mockResolvedValue({ content: 'raw output', metadata: { flagged: ['A'] } });

    await dispatch(fakeJob);

    expect(appendJobHistoryMock).toHaveBeenCalledWith('/data/state', 'fake-job', {
      date: '2026-08-08',
      content: 'raw output',
      metadata: { flagged: ['A'] },
    });
  });

  it('persists the Gemini-humanized text, not the raw summarize.content', async () => {
    executeMock.mockResolvedValue({
      summarize: { content: 'raw data', prompt: 'Be friendly', fallback: 'fallback msg' },
    });

    await dispatch(fakeJob);

    expect(appendJobHistoryMock).toHaveBeenCalledWith(
      '/data/state',
      'fake-job',
      expect.objectContaining({ content: 'Humanized message' }),
    );
  });

  it('persists the fallback text when Gemini fails', async () => {
    executeMock.mockResolvedValue({
      summarize: { content: 'raw data', prompt: 'Be friendly', fallback: 'fallback msg' },
    });
    humanizeMock.mockRejectedValue(new Error('503 Service Unavailable'));

    await dispatch(fakeJob);

    expect(appendJobHistoryMock).toHaveBeenCalledWith(
      '/data/state',
      'fake-job',
      expect.objectContaining({ content: 'fallback msg' }),
    );
  });

  it('does not persist history when job.execute() rejects', async () => {
    executeMock.mockRejectedValue(new Error('network error'));
    await dispatch(fakeJob);
    expect(appendJobHistoryMock).not.toHaveBeenCalled();
  });

  it('does not persist history when telegram.send() rejects', async () => {
    executeMock.mockResolvedValue({ content: 'raw output' });
    sendMock.mockRejectedValue(new Error('telegram down'));
    await dispatch(fakeJob);
    expect(appendJobHistoryMock).not.toHaveBeenCalled();
  });
});

describe('start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers only enabled jobs with node-cron', () => {
    start();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  it('registers with the correct cron expression and timezone', () => {
    process.env.TZ = 'Asia/Taipei';
    start();
    expect(scheduleMock).toHaveBeenCalledWith(
      '0 7 * * *',
      expect.any(Function),
      expect.objectContaining({ timezone: 'Asia/Taipei' }),
    );
  });
});
