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

import { start, dispatch } from '../src/scheduler.js';

const fakeJob = {
  id: 'fake-job',
  description: 'Fake job for dispatch tests',
  schedule: '0 7 * * *',
  enabled: true,
  execute: executeMock,
};

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
