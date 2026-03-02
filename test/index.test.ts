import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';

const startMock = vi.hoisted(() => vi.fn());

vi.mock('../src/scheduler.js', () => ({ start: startMock }));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('index entrypoint', () => {
  let processOnSpy: MockInstance<typeof process.on>;
  let processExitSpy: MockInstance<typeof process.exit>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    processOnSpy = vi.spyOn(process, 'on');
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    processOnSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('calls scheduler.start() on load', async () => {
    await import('../src/index.js');
    expect(startMock).toHaveBeenCalledOnce();
  });

  it('registers SIGTERM and SIGINT handlers', async () => {
    await import('../src/index.js');
    const events = processOnSpy.mock.calls.map((c) => c[0]);
    expect(events).toContain('SIGTERM');
    expect(events).toContain('SIGINT');
  });

  it('SIGTERM handler calls process.exit(0)', async () => {
    await import('../src/index.js');
    const handler = processOnSpy.mock.calls.find((c) => c[0] === 'SIGTERM')?.[1] as () => void;
    handler();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it('SIGINT handler calls process.exit(0)', async () => {
    await import('../src/index.js');
    const handler = processOnSpy.mock.calls.find((c) => c[0] === 'SIGINT')?.[1] as () => void;
    handler();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });
});
