import type { Job, JobContext, JobHistoryEntry, JobResult } from '../types.js';

export interface Fund {
  id: string;
  name: string;
  company: string;
  isRepresentative: boolean;
  fundSizeMillionsUsd: number | null;
  /** Cathay-provided 1Y return — always present, but not self-verified. */
  return1Y: number | null;
  /** Self-computed drawdown from the highest NAV we've observed tracking this fund. */
  pctOffHigh: number | null;
  navHigh: number | null;
  navHighDate: string | null;
  navTrackedSince: string | null;
  /** Self-computed returns, derived purely from NAV points we've recorded. Null until enough history exists. */
  selfReturn1Y: number | null;
  selfReturn3Y: number | null;
  selfReturn5Y: number | null;
}

export interface CategoryData {
  macro: string;
  funds: Fund[];
}

export interface FundSnapshot {
  categories: Record<string, CategoryData>;
}

interface Manifest {
  latest: string | null;
}

/** The largest representative fund in a category — the one used as that market's indicator. */
export function pickCategoryLeader(funds: Fund[]): Fund | null {
  const candidates = funds.filter((f) => f.isRepresentative && f.fundSizeMillionsUsd != null);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, f) =>
    f.fundSizeMillionsUsd! > best.fundSizeMillionsUsd! ? f : best,
  );
}

export interface DurationSignal {
  years: 1 | 3 | 5;
  returnPct: number;
  /** false when this had to fall back to Cathay's own (untrusted) 1Y figure. */
  selfComputed: boolean;
}

/** Longest-horizon return we can honestly report, preferring self-computed over the provider's field. */
export function longDurationSignal(fund: Fund): DurationSignal | null {
  if (fund.selfReturn5Y != null) return { years: 5, returnPct: fund.selfReturn5Y, selfComputed: true };
  if (fund.selfReturn3Y != null) return { years: 3, returnPct: fund.selfReturn3Y, selfComputed: true };
  if (fund.selfReturn1Y != null) return { years: 1, returnPct: fund.selfReturn1Y, selfComputed: true };
  if (fund.return1Y != null) return { years: 1, returnPct: fund.return1Y, selfComputed: false };
  return null;
}

export interface Severity {
  /** More negative = worse. */
  score: number;
  reason: 'drawdown' | 'duration';
  duration: DurationSignal | null;
}

/** Worse of (drawdown from observed high) and (longest-horizon negative return), or null if neither applies. */
export function severity(fund: Fund): Severity | null {
  const duration = longDurationSignal(fund);
  const options: { score: number; reason: 'drawdown' | 'duration' }[] = [];

  if (fund.pctOffHigh != null) options.push({ score: fund.pctOffHigh, reason: 'drawdown' });
  if (duration != null && duration.returnPct < 0) options.push({ score: duration.returnPct, reason: 'duration' });

  if (options.length === 0) return null;

  const worst = options.reduce((a, b) => (b.score < a.score ? b : a));
  return { score: worst.score, reason: worst.reason, duration };
}

export interface Candidate {
  category: string;
  macro: string;
  fund: Fund;
  severity: Severity;
}

const DIP_THRESHOLD_PCT = -10;
const MAX_CANDIDATES = 3;

/** Picks up to `count` category leaders whose severity crosses the dip threshold, worst first. */
export function selectTopDips(
  categories: Record<string, CategoryData>,
  count = MAX_CANDIDATES,
  thresholdPct = DIP_THRESHOLD_PCT,
): Candidate[] {
  const candidates: Candidate[] = [];

  for (const [category, data] of Object.entries(categories)) {
    const leader = pickCategoryLeader(data.funds);
    if (!leader) continue;

    const sev = severity(leader);
    if (!sev || sev.score > thresholdPct) continue;

    candidates.push({ category, macro: data.macro, fund: leader, severity: sev });
  }

  candidates.sort((a, b) => a.severity.score - b.severity.score);
  return candidates.slice(0, count);
}

interface FundAppearance {
  fundId: string;
  days: number;
}

/** Calendar-day streak of actual notifications, using the scheduler's local date. */
export function consecutiveNotificationDays(
  history: JobHistoryEntry[],
  today: string,
  fundId: string,
): number {
  const yesterday = new Date(today + 'T00:00:00Z');
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const previousDate = yesterday.toISOString().slice(0, 10);
  const appearance = (date: string): FundAppearance | undefined => {
    const entries = history.find((entry) => entry.date === date)?.metadata?.appearances;
    if (!Array.isArray(entries)) return undefined;
    return entries.find((entry: unknown): entry is FundAppearance => {
      if (typeof entry !== 'object' || entry === null) return false;
      const item = entry as Partial<FundAppearance>;
      return item.fundId === fundId && Number.isSafeInteger(item.days) && item.days! > 0;
    });
  };
  const previous = appearance(previousDate);
  if (previous) return previous.days + 1;
  // Same-day retries must not increment an already persisted notification count.
  return appearance(today)?.days ?? 1;
}

function formatCandidate(c: Candidate, days: number): string {
  const { fund, severity: sev, category } = c;
  const lines = [`${category} — ${fund.name} (${fund.company})`];

  lines.push('  In this notification for ' + days + ' consecutive ' + (days === 1 ? 'day' : 'days'));

  if (fund.pctOffHigh != null) {
    const since = fund.navHighDate ? ` (high on ${fund.navHighDate})` : '';
    lines.push(`  ${fund.pctOffHigh.toFixed(1)}% off its tracked high${since}`);
  }

  if (sev.duration) {
    const label = sev.duration.selfComputed
      ? `${sev.duration.years}Y self-tracked return`
      : `${sev.duration.years}Y return (provider-reported)`;
    lines.push(`  ${label}: ${sev.duration.returnPct.toFixed(1)}%`);
  }

  return lines.join('\n');
}

export const fundDipWatch: Job = {
  id: 'fund-dip-watch',
  description: 'Daily scan of the largest fund in each category for sustained or drastic dips',
  schedule: '0 8 * * *',
  enabled: true,

  async execute(ctx: JobContext): Promise<JobResult> {
    const baseUrl = process.env.FUND_ANALYSIS_URL ?? 'https://fund-analysis.the3dsandwich.com';

    const manifestRes = await fetch(`${baseUrl}/snapshots/manifest.json`);
    if (!manifestRes.ok) throw new Error(`fund-analysis manifest error: ${manifestRes.status}`);
    const manifest = (await manifestRes.json()) as Manifest;
    if (!manifest.latest) throw new Error('fund-analysis has no snapshots yet');

    const snapshotRes = await fetch(`${baseUrl}/snapshots/${manifest.latest}.json`);
    if (!snapshotRes.ok) throw new Error(`fund-analysis snapshot error: ${snapshotRes.status}`);
    const snapshot = (await snapshotRes.json()) as FundSnapshot;

    // Match the scheduler's persisted history dates, including across DST.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: process.env.TZ ?? 'UTC' });
    const picks = selectTopDips(snapshot.categories);
    const appearances = picks.map((pick) => ({
      fundId: pick.fund.id,
      days: consecutiveNotificationDays(ctx.history, today, pick.fund.id),
    }));

    const header = `📉 Fund Dip Watch (${manifest.latest})`;
    const content =
      picks.length > 0
        ? [header, '', ...picks.map((pick, index) => formatCandidate(pick, appearances[index].days))].join('\n\n')
        : `${header}\n\nNo category leader meets the dip threshold today.`;

    return {
      content,
      metadata: { flagged: picks.map((p) => p.category), appearances },
    };
  },
};
