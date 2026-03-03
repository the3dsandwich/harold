import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

const dispatchMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>());

vi.mock('../src/scheduler.js', () => ({
  dispatch: dispatchMock,
  start: vi.fn(),
}));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/jobs/index.js', () => ({
  enabledJob: {
    id: 'enabled-job',
    description: 'An enabled test job',
    schedule: '0 7 * * *',
    enabled: true,
    execute: vi.fn(),
  },
  disabledJob: {
    id: 'disabled-job',
    description: 'A disabled test job',
    schedule: '0 8 * * *',
    enabled: false,
    execute: vi.fn(),
  },
}));

import { app } from '../src/server.js';

describe('GET /api/jobs', () => {
  it('returns all registered jobs', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('returns correct fields for each job', async () => {
    const res = await request(app).get('/api/jobs');
    const body = res.body as Array<{ id: string; description: string; schedule: string; enabled: boolean }>;
    const job = body.find((j) => j.id === 'enabled-job');
    expect(job).toMatchObject({
      id: 'enabled-job',
      description: 'An enabled test job',
      schedule: '0 7 * * *',
      enabled: true,
    });
  });
});

describe('POST /api/jobs/:id/run', () => {
  it('returns 404 for unknown job id', async () => {
    const res = await request(app).post('/api/jobs/nonexistent/run');
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toContain('nonexistent');
  });

  it('returns sent text on success', async () => {
    dispatchMock.mockResolvedValue('Good morning! It is 22°C.');
    const res = await request(app).post('/api/jobs/enabled-job/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'enabled-job', sent: 'Good morning! It is 22°C.' });
  });

  it('returns 500 when dispatch returns null', async () => {
    dispatchMock.mockResolvedValue(null);
    const res = await request(app).post('/api/jobs/enabled-job/run');
    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBeTruthy();
  });

  it('calls dispatch with the correct job', async () => {
    dispatchMock.mockResolvedValue('ok');
    await request(app).post('/api/jobs/enabled-job/run');
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'enabled-job' }),
    );
  });
});

describe('GET /', () => {
  it('serves the dashboard HTML', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Harold');
  });
});
