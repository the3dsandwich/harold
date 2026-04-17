import type { Job, JobResult } from '../types.js';

interface CurrencyRatesResponse {
  date: string;
  [base: string]: Record<string, number> | string;
}

const primaryUrl = (base: string) =>
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base}.json`;

const fallbackUrl = (base: string) =>
  `https://latest.currency-api.pages.dev/v1/currencies/${base}.json`;

const fetchRates = async (base: string): Promise<CurrencyRatesResponse> => {
  for (const url of [primaryUrl(base), fallbackUrl(base)]) {
    const response = await fetch(url);
    if (response.ok) return response.json() as Promise<CurrencyRatesResponse>;
  }
  throw new Error(`Currency API unavailable for base currency: ${base}`);
};

const fmt = (n: number) => n.toFixed(2);

export const currencyRates: Job = {
  id: 'currency-rates',
  description: 'Daily 9am comparison: NTD→CAD direct vs NTD→USD→CAD route',
  schedule: '0 9 * * *',
  enabled: true,

  async execute(): Promise<JobResult> {
    const [twdData, usdData] = await Promise.all([
      fetchRates('twd'),
      fetchRates('usd'),
    ]);

    const twd = twdData['twd'] as Record<string, number>;
    const usd = usdData['usd'] as Record<string, number>;

    const twdUsd = twd['usd'];
    const twdCad = twd['cad'];
    const usdCad = usd['cad'];
    const date = twdData['date'];

    const ntdPerCadDirect = 1 / twdCad;
    const ntdPerCadViaUsd = 1 / (twdUsd * usdCad);
    const diff = ntdPerCadViaUsd - ntdPerCadDirect;

    let verdict: string;
    if (Math.abs(diff) < 0.005) {
      verdict = '➖ Both routes are equivalent today';
    } else if (diff < 0) {
      verdict = `✅ Via USD saves ${fmt(Math.abs(diff))} NTD per CAD`;
    } else {
      verdict = `✅ Direct saves ${fmt(diff)} NTD per CAD`;
    }

    const content = [
      `📅 ${date}`,
      ``,
      `🇹🇼→🇨🇦 Exchange Rate Comparison`,
      ``,
      `🔹 Direct:   1 CAD = ${fmt(ntdPerCadDirect)} NTD`,
      `🔹 Via USD:  1 CAD = ${fmt(ntdPerCadViaUsd)} NTD`,
      ``,
      verdict,
    ].join('\n');

    return { content };
  },
};
