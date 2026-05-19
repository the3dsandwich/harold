import { describe, it, expect, vi, beforeEach } from 'vitest';
import { currencyRates } from '../../src/jobs/currency-rates.js';

function makeTwdResponse(overrides: { usd?: number; cad?: number; date?: string } = {}) {
  const r = { usd: 0.031679137, cad: 0.043402187, date: '2026-04-17', ...overrides };
  return {
    ok: true,
    json: () => Promise.resolve({ date: r.date, twd: { usd: r.usd, cad: r.cad } }),
  };
}

function makeUsdResponse(overrides: { cad?: number; date?: string } = {}) {
  const r = { cad: 1.37005586, date: '2026-04-17', ...overrides };
  return {
    ok: true,
    json: () => Promise.resolve({ date: r.date, usd: { cad: r.cad } }),
  };
}

describe('currencyRates job', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('has correct static metadata', () => {
    expect(currencyRates.id).toBe('currency-rates');
    expect(currencyRates.schedule).toBe('0 9 * * *');
    expect(currencyRates.enabled).toBe(true);
    expect(currencyRates.description).toBeTruthy();
  });

  it('content includes date, both routes, and a verdict', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeTwdResponse())
      .mockResolvedValueOnce(makeUsdResponse()),
    );

    const result = await currencyRates.execute();
    expect('content' in result).toBe(true);
    if (!('content' in result)) return;

    const { content } = result;
    expect(content).toContain('2026-04-17');
    expect(content).toContain('🇹🇼→🇨🇦');
    expect(content).toContain('Direct');
    expect(content).toContain('Via USD');
    expect(content).toContain('NTD');
  });

  it('computes direct route as 1 / twd_cad', async () => {
    // twd_cad = 0.04, so 1 CAD = 25.00 NTD
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeTwdResponse({ usd: 0.03, cad: 0.04 }))
      .mockResolvedValueOnce(makeUsdResponse({ cad: 1.5 })),
    );

    const result = await currencyRates.execute();
    if (!('content' in result)) return;
    expect(result.content).toContain('Direct:   1 CAD = 25.0000 NTD');
  });

  it('computes via-USD route as 1 / (twd_usd * usd_cad)', async () => {
    // twd_usd = 0.03, usd_cad = 1.5 → twd_cad_via_usd = 0.03 * 1.5 = 0.045 → 1 CAD = 22.22 NTD
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeTwdResponse({ usd: 0.03, cad: 0.04 }))
      .mockResolvedValueOnce(makeUsdResponse({ cad: 1.5 })),
    );

    const result = await currencyRates.execute();
    if (!('content' in result)) return;
    expect(result.content).toContain('Via USD:  1 CAD = 22.2222 NTD');
  });

  it('verdict says via USD is cheaper when via-USD NTD cost is lower', async () => {
    // direct: 1 CAD = 25.00 NTD, via USD: 1 CAD = 22.22 NTD → via USD cheaper
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeTwdResponse({ usd: 0.03, cad: 0.04 }))
      .mockResolvedValueOnce(makeUsdResponse({ cad: 1.5 })),
    );

    const result = await currencyRates.execute();
    if (!('content' in result)) return;
    expect(result.content).toContain('Via USD saves');
  });

  it('verdict says direct is cheaper when direct NTD cost is lower', async () => {
    // twd_usd = 0.03, usd_cad = 0.8 → via USD: 1 CAD = 1/(0.03*0.8) = 41.67 NTD
    // direct: twd_cad = 0.04 → 1 CAD = 25.00 NTD → direct is cheaper
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeTwdResponse({ usd: 0.03, cad: 0.04 }))
      .mockResolvedValueOnce(makeUsdResponse({ cad: 0.8 })),
    );

    const result = await currencyRates.execute();
    if (!('content' in result)) return;
    expect(result.content).toContain('Direct saves');
  });

  it('verdict says equivalent when difference is negligible', async () => {
    // make twd_cad exactly equal to twd_usd * usd_cad
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(makeTwdResponse({ usd: 0.03, cad: 0.045 }))
      .mockResolvedValueOnce(makeUsdResponse({ cad: 1.5 })),
    );

    const result = await currencyRates.execute();
    if (!('content' in result)) return;
    expect(result.content).toContain('equivalent');
  });

  it('tries fallback URL when primary returns non-ok', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('jsdelivr') && url.includes('/twd.json'))
        return Promise.resolve({ ok: false, status: 503 });
      if (url.includes('/twd.json'))
        return Promise.resolve(makeTwdResponse());
      return Promise.resolve(makeUsdResponse());
    });

    vi.stubGlobal('fetch', fetchMock);

    const result = await currencyRates.execute();
    expect('content' in result).toBe(true);
    const calledUrls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(calledUrls.some((u) => u.includes('currency-api.pages.dev'))).toBe(true);
  });

  it('throws when both primary and fallback fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(currencyRates.execute()).rejects.toThrow('Currency API unavailable');
  });
});
