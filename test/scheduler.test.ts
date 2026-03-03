import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JobResult } from '../src/types.js';

const scheduleMock = vi.hoisted(() => vi.fn());
const sendMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const humanizeMock = vi.hoisted(() => vi.fn().mockResolvedValue('Humanized message'));
const executeMock = vi.hoisted(() => vi.fn<() => Promise<JobResult>>());

vi.mock('node-cron', () => ({ default: { schedule: scheduleMock } }));
vi.mock('../src/lib/telegram.js', () => ({ send: sendMock }));
vi.mock('../src/lib/gemini.js', () => ({ humanize: humanizeMock }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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
  enabled: true,
  execute: executeMock,
};

describe('formatError', () => {
  it('returns the message for a plain Error', () => {
    expect(formatError(new Error('something went wrong'))).toBe('something went wrong');
  });

  it('joins cause chain messages with colon separator', () => {
    const root = new Error('root cause');
    const mid = new Error('');
    const top = new Error('fetch failed');
    (mid as Error & { cause: unknown }).cause = root;
    (top as Error & { cause: unknown }).cause = mid;
    expect(formatError(top)).toBe('fetch failed: root cause');
  });

  it('skips empty messages in the cause chain', () => {
    const inner = new Error('ENOTFOUND api.open-meteo.com');
    const middle = new Error('');
    const outer = new Error('fetch failed');
    (middle as Error & { cause: unknown }).cause = inner;
    (outer as Error & { cause: unknown }).cause = middle;
    expect(formatError(outer)).toBe('fetch failed: ENOTFOUND api.open-meteo.com');
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
  });

  it('sends raw content when summarize is not present', async () => {
    executeMock.mockResolvedValue({ content: 'raw output' });
    await dispatch(fakeJob);
    expect(sendMock).toHaveBeenCalledWith('raw output');
    expect(humanizeMock).not.toHaveBeenCalled();
  });

  it('sends raw content when summarize.enabled is false', async () => {
    executeMock.mockResolvedValue({
      content: 'raw output',
      summarize: { enabled: false, prompt: 'ignored' },
    });
    await dispatch(fakeJob);
    expect(sendMock).toHaveBeenCalledWith('raw output');
    expect(humanizeMock).not.toHaveBeenCalled();
  });

  it('passes content through gemini when summarize.enabled is true', async () => {
    executeMock.mockResolvedValue({
      content: 'raw output',
      summarize: { enabled: true, prompt: 'Be friendly' },
    });
    await dispatch(fakeJob);
    expect(humanizeMock).toHaveBeenCalledWith('raw output', 'Be friendly');
    expect(sendMock).toHaveBeenCalledWith('Humanized message');
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
