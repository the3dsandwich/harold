import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fundDipWatch,
  pickCategoryLeader,
  longDurationSignal,
  severity,
  selectTopDips,
  recentlyFlaggedCategories,
  type Fund,
  type CategoryData,
} from '../../src/jobs/fund-dip-watch.js';
import type { JobHistoryEntry } from '../../src/types.js';

function makeFund(overrides: Partial<Fund> = {}): Fund {
  return {
    id: '00010001',
    name: 'Test Fund',
    company: 'JPMorgan',
    isRepresentative: true,
    fundSizeMillionsUsd: 1000,
    return1Y: null,
    pctOffHigh: null,
    navHigh: null,
    navHighDate: null,
    navTrackedSince: null,
    selfReturn1Y: null,
    selfReturn3Y: null,
    selfReturn5Y: null,
    ...overrides,
  };
}

describe('pickCategoryLeader', () => {
  it('returns null for an empty fund list', () => {
    expect(pickCategoryLeader([])).toBeNull();
  });

  it('returns null when no fund is a representative with known AUM', () => {
    const funds = [makeFund({ isRepresentative: false }), makeFund({ fundSizeMillionsUsd: null })];
    expect(pickCategoryLeader(funds)).toBeNull();
  });

  it('picks the representative with the highest AUM', () => {
    const small = makeFund({ id: 'small', fundSizeMillionsUsd: 500 });
    const big = makeFund({ id: 'big', fundSizeMillionsUsd: 5000 });
    const medium = makeFund({ id: 'medium', fundSizeMillionsUsd: 2000 });
    expect(pickCategoryLeader([small, big, medium])?.id).toBe('big');
  });

  it('ignores non-representative siblings even if they have higher AUM', () => {
    const rep = makeFund({ id: 'rep', fundSizeMillionsUsd: 1000, isRepresentative: true });
    const sibling = makeFund({ id: 'sibling', fundSizeMillionsUsd: 1000, isRepresentative: false });
    expect(pickCategoryLeader([rep, sibling])?.id).toBe('rep');
  });
});

describe('longDurationSignal', () => {
  it('returns null when no return field is available', () => {
    expect(longDurationSignal(makeFund())).toBeNull();
  });

  it('prefers selfReturn5Y over everything else', () => {
    const fund = makeFund({ selfReturn5Y: -40, selfReturn3Y: -20, selfReturn1Y: -10, return1Y: -5 });
    expect(longDurationSignal(fund)).toEqual({ years: 5, returnPct: -40, selfComputed: true });
  });

  it('falls back to selfReturn3Y when 5Y is unavailable', () => {
    const fund = makeFund({ selfReturn3Y: -20, selfReturn1Y: -10, return1Y: -5 });
    expect(longDurationSignal(fund)).toEqual({ years: 3, returnPct: -20, selfComputed: true });
  });

  it('falls back to selfReturn1Y when 3Y and 5Y are unavailable', () => {
    const fund = makeFund({ selfReturn1Y: -10, return1Y: -5 });
    expect(longDurationSignal(fund)).toEqual({ years: 1, returnPct: -10, selfComputed: true });
  });

  it('falls back to the provider 1Y return, marked as not self-computed, when nothing self-tracked exists yet', () => {
    const fund = makeFund({ return1Y: -5 });
    expect(longDurationSignal(fund)).toEqual({ years: 1, returnPct: -5, selfComputed: false });
  });
});

describe('severity', () => {
  it('returns null when neither drawdown nor a negative duration return is available', () => {
    expect(severity(makeFund())).toBeNull();
  });

  it('returns null when the only duration signal is positive and there is no drawdown data', () => {
    expect(severity(makeFund({ return1Y: 12 }))).toBeNull();
  });

  it('uses drawdown when it is worse than the duration return', () => {
    const fund = makeFund({ pctOffHigh: -45, return1Y: -10 });
    const result = severity(fund);
    expect(result?.score).toBe(-45);
    expect(result?.reason).toBe('drawdown');
  });

  it('uses the duration return when it is worse than drawdown', () => {
    const fund = makeFund({ pctOffHigh: -5, selfReturn3Y: -25 });
    const result = severity(fund);
    expect(result?.score).toBe(-25);
    expect(result?.reason).toBe('duration');
  });

  it('ignores a positive duration return and falls back to drawdown alone', () => {
    const fund = makeFund({ pctOffHigh: -15, return1Y: 8 });
    const result = severity(fund);
    expect(result?.score).toBe(-15);
    expect(result?.reason).toBe('drawdown');
  });

  it('still attaches the duration signal for messaging even when drawdown wins', () => {
    const fund = makeFund({ pctOffHigh: -45, selfReturn1Y: -10 });
    const result = severity(fund);
    expect(result?.duration).toEqual({ years: 1, returnPct: -10, selfComputed: true });
  });
});

describe('selectTopDips', () => {
  const categories: Record<string, CategoryData> = {
    'US Large Cap': { macro: 'Equity - US', funds: [makeFund({ id: 'us', pctOffHigh: -55 })] },
    'Sector - Energy': { macro: 'Equity - Sector', funds: [makeFund({ id: 'energy', pctOffHigh: -25 })] },
    'Sector - Technology': { macro: 'Equity - Sector', funds: [makeFund({ id: 'tech', pctOffHigh: -12 })] },
    'Global Equity': { macro: 'Equity - Global', funds: [makeFund({ id: 'global', pctOffHigh: -2 })] },
    'India Equity': { macro: 'Equity - Asia', funds: [] }, // no leader available
  };

  it('excludes categories with no viable leader', () => {
    const picks = selectTopDips(categories, new Set());
    expect(picks.some((p) => p.category === 'India Equity')).toBe(false);
  });

  it('excludes candidates below the dip threshold', () => {
    const picks = selectTopDips(categories, new Set());
    expect(picks.some((p) => p.category === 'Global Equity')).toBe(false); // only -2%
  });

  it('sorts most severe first', () => {
    const picks = selectTopDips(categories, new Set());
    expect(picks.map((p) => p.category)).toEqual(['US Large Cap', 'Sector - Energy', 'Sector - Technology']);
  });

  it('respects the requested count', () => {
    const picks = selectTopDips(categories, new Set(), 2);
    expect(picks).toHaveLength(2);
  });

  it('excludes categories already flagged recently', () => {
    const picks = selectTopDips(categories, new Set(['US Large Cap']));
    expect(picks.some((p) => p.category === 'US Large Cap')).toBe(false);
    expect(picks[0].category).toBe('Sector - Energy');
  });
});

describe('recentlyFlaggedCategories', () => {
  const entry = (date: string, flagged: string[]): JobHistoryEntry => ({
    date,
    content: 'x',
    metadata: { flagged },
  });

  it('returns an empty set for empty history', () => {
    expect(recentlyFlaggedCategories([], '2026-08-08').size).toBe(0);
  });

  it('includes categories flagged within the window', () => {
    const history = [entry('2026-08-06', ['US Large Cap'])];
    const flagged = recentlyFlaggedCategories(history, '2026-08-08');
    expect(flagged.has('US Large Cap')).toBe(true);
  });

  it('excludes categories flagged exactly 7 days ago or earlier', () => {
    const history = [entry('2026-08-01', ['US Large Cap'])]; // exactly 7 days before 08-08
    const flagged = recentlyFlaggedCategories(history, '2026-08-08');
    expect(flagged.has('US Large Cap')).toBe(false);
  });

  it('includes a category flagged 6 days ago', () => {
    const history = [entry('2026-08-02', ['US Large Cap'])]; // 6 days before 08-08
    const flagged = recentlyFlaggedCategories(history, '2026-08-08');
    expect(flagged.has('US Large Cap')).toBe(true);
  });

  it('unions flagged categories across multiple days in the window', () => {
    const history = [entry('2026-08-06', ['A']), entry('2026-08-07', ['B'])];
    const flagged = recentlyFlaggedCategories(history, '2026-08-08');
    expect(flagged.has('A')).toBe(true);
    expect(flagged.has('B')).toBe(true);
  });

  it('handles entries with no metadata gracefully', () => {
    const history: JobHistoryEntry[] = [{ date: '2026-08-07', content: 'x' }];
    expect(() => recentlyFlaggedCategories(history, '2026-08-08')).not.toThrow();
  });
});

describe('fundDipWatch job', () => {
  const manifestResponse = { ok: true, json: () => Promise.resolve({ latest: '2026-08-08' }) };

  function snapshotResponse(categories: Record<string, CategoryData>) {
    return { ok: true, json: () => Promise.resolve({ categories }) };
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('manifest.json')) return Promise.resolve(manifestResponse);
        return Promise.resolve(
          snapshotResponse({
            'US Large Cap': { macro: 'Equity - US', funds: [makeFund({ id: 'us', name: 'US Leader', pctOffHigh: -55, navHighDate: '2026-01-01' })] },
            'Sector - Energy': { macro: 'Equity - Sector', funds: [makeFund({ id: 'energy', name: 'Energy Leader', pctOffHigh: -25 })] },
          }),
        );
      }),
    );
    process.env.FUND_ANALYSIS_URL = 'https://fund-analysis.example.test';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FUND_ANALYSIS_URL;
  });

  it('has correct static metadata', () => {
    expect(fundDipWatch.id).toBe('fund-dip-watch');
    expect(fundDipWatch.enabled).toBe(true);
    expect(fundDipWatch.description).toBeTruthy();
    expect(fundDipWatch.schedule).toBeTruthy();
  });

  it('fetches the manifest and latest snapshot from FUND_ANALYSIS_URL', async () => {
    await fundDipWatch.execute({ history: [] });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain('https://fund-analysis.example.test/snapshots/manifest.json');
    expect(urls).toContain('https://fund-analysis.example.test/snapshots/2026-08-08.json');
  });

  it('content lists the dip candidates with category and fund name', async () => {
    const result = await fundDipWatch.execute({ history: [] });
    expect('content' in result).toBe(true);
    if (!('content' in result)) return;
    expect(result.content).toContain('US Large Cap');
    expect(result.content).toContain('US Leader');
    expect(result.content).toContain('Sector - Energy');
  });

  it('returns metadata.flagged with the picked category names', async () => {
    const result = await fundDipWatch.execute({ history: [] });
    expect(result.metadata).toEqual({ flagged: ['US Large Cap', 'Sector - Energy'] });
  });

  it('excludes categories flagged within the last week via ctx.history', async () => {
    const history: JobHistoryEntry[] = [
      { date: '2026-08-07', content: 'prior run', metadata: { flagged: ['US Large Cap'] } },
    ];
    const result = await fundDipWatch.execute({ history });
    expect('content' in result).toBe(true);
    if (!('content' in result)) return;
    expect(result.content).not.toContain('US Large Cap');
    expect(result.metadata).toEqual({ flagged: ['Sector - Energy'] });
  });

  it('sends a "nothing new" message and empty flagged metadata when everything is deduped', async () => {
    const history: JobHistoryEntry[] = [
      {
        date: '2026-08-07',
        content: 'prior run',
        metadata: { flagged: ['US Large Cap', 'Sector - Energy'] },
      },
    ];
    const result = await fundDipWatch.execute({ history });
    expect('content' in result).toBe(true);
    if (!('content' in result)) return;
    expect(result.content).toContain('Nothing new');
    expect(result.metadata).toEqual({ flagged: [] });
  });

  it('throws when the manifest request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(fundDipWatch.execute({ history: [] })).rejects.toThrow('manifest');
  });

  it('throws when there are no snapshots yet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ latest: null }) }),
    );
    await expect(fundDipWatch.execute({ history: [] })).rejects.toThrow('no snapshots');
  });

  it('throws when the snapshot request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('manifest.json')) return Promise.resolve(manifestResponse);
        return Promise.resolve({ ok: false, status: 500 });
      }),
    );
    await expect(fundDipWatch.execute({ history: [] })).rejects.toThrow('snapshot');
  });
});
