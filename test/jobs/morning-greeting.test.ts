import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  morningGreeting,
  describeWeatherCode,
  WEATHER_CODES,
} from '../../src/jobs/morning-greeting.js';

// Builds a full mock Open-Meteo response.
// daily[0] = yesterday, daily[1] = today (past_days=1, forecast_days=1)
function makeResponse(overrides: {
  nowTemp?: number;
  nowFeels?: number;
  humidity?: number;
  precipitation?: number;
  weatherCode?: number;
  windSpeed?: number;
  windGusts?: number;
  ydayHigh?: number;
  todayHigh?: number;
  todayLow?: number;
  todayFeelsHigh?: number;
  todayFeelsLow?: number;
  rainMm?: number;
  rainChance?: number | null;
} = {}) {
  const r = {
    nowTemp: 22.4, nowFeels: 21.0, humidity: 65, precipitation: 0,
    weatherCode: 1, windSpeed: 12.3, windGusts: 18.5,
    ydayHigh: 20.0,
    todayHigh: 25.0, todayLow: 18.0, todayFeelsHigh: 24.0, todayFeelsLow: 17.0,
    rainMm: 3.5, rainChance: 60,
    ...overrides,
  };
  return {
    ok: true,
    json: () => ({
      current: {
        temperature_2m: r.nowTemp,
        apparent_temperature: r.nowFeels,
        relative_humidity_2m: r.humidity,
        precipitation: r.precipitation,
        weather_code: r.weatherCode,
        wind_speed_10m: r.windSpeed,
        wind_gusts_10m: r.windGusts,
      },
      daily: {
        time: ['2026-03-02', '2026-03-03'],
        temperature_2m_max:         [r.ydayHigh, r.todayHigh],
        temperature_2m_min:         [15.0,       r.todayLow],
        apparent_temperature_max:   [19.0,       r.todayFeelsHigh],
        apparent_temperature_min:   [14.0,       r.todayFeelsLow],
        precipitation_sum:          [0.0,        r.rainMm],
        precipitation_probability_max: [null,    r.rainChance],
        weather_code:               [1,          r.weatherCode],
      },
    }),
  };
}

describe('describeWeatherCode', () => {
  it('returns description for known codes', () => {
    expect(describeWeatherCode(0)).toBe('clear sky');
    expect(describeWeatherCode(1)).toBe('mainly clear');
    expect(describeWeatherCode(63)).toBe('moderate rain');
    expect(describeWeatherCode(95)).toBe('thunderstorm');
  });

  it('returns fallback message for unknown codes', () => {
    expect(describeWeatherCode(999)).toBe('unknown condition (code 999)');
    expect(describeWeatherCode(-1)).toBe('unknown condition (code -1)');
  });

  it('covers all codes in WEATHER_CODES', () => {
    for (const code of Object.keys(WEATHER_CODES).map(Number)) {
      expect(describeWeatherCode(code)).toBe(WEATHER_CODES[code]);
    }
  });
});

describe('morningGreeting job', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct static metadata', () => {
    expect(morningGreeting.id).toBe('morning-greeting');
    expect(morningGreeting.schedule).toBe('0 7 * * *');
    expect(morningGreeting.enabled).toBe(true);
    expect(morningGreeting.description).toBeTruthy();
  });

  it('content includes current conditions, today forecast, rain, and trend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse()));

    const result = await morningGreeting.execute();
    expect('summarize' in result).toBe(true);
    if (!('summarize' in result)) return;

    const { content } = result.summarize;
    expect(content).toContain('22°C');         // now temp (rounded from 22.4)
    expect(content).toContain('21°C');         // feels like
    expect(content).toContain('mainly clear'); // weather condition
    expect(content).toContain('65%');          // humidity
    expect(content).toContain('12 km/h');      // wind
    expect(content).toContain('25°C');         // today high
    expect(content).toContain('18°C');         // today low
    expect(content).toContain('60%');          // rain chance
    expect(content).toContain('3.5 mm');       // rain amount
    expect(content).toContain('5°C warmer');   // trend: 25 - 20 = +5
  });

  it('prompt instructs Harold to use emojis, range, umbrella, and trend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse()));

    const result = await morningGreeting.execute();
    if (!('summarize' in result)) return;

    const { prompt } = result.summarize;
    expect(prompt).toContain('Harold');
    expect(prompt).toContain('emoji');
    expect(prompt).toContain('umbrella');
    expect(prompt).toContain('yesterday');
    expect(prompt).toContain('range');
  });

  it('fallback includes current temp, today high/low, and trend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse()));

    const result = await morningGreeting.execute();
    if (!('summarize' in result)) return;

    const { fallback } = result.summarize;
    expect(fallback).toContain('22°C');  // now temp
    expect(fallback).toContain('25°C');  // today high
    expect(fallback).toContain('18°C');  // today low
    expect(fallback).toContain('5°C warmer than yesterday');
  });

  it('fallback includes umbrella emoji and hint when rain chance >= 40%', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ rainChance: 40 })));

    const result = await morningGreeting.execute();
    if (!('summarize' in result)) return;
    expect(result.summarize.fallback).toContain('umbrella');
  });

  it('fallback omits umbrella hint when rain chance < 40%', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse({ rainChance: 20 })));

    const result = await morningGreeting.execute();
    if (!('summarize' in result)) return;
    expect(result.summarize.fallback).not.toContain('umbrella');
  });

  it('content says cooler when today high < yesterday high', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeResponse({ ydayHigh: 28.0, todayHigh: 22.0 }),
    ));

    const result = await morningGreeting.execute();
    if (!('summarize' in result)) return;
    expect(result.summarize.content).toContain('6°C cooler than yesterday');
  });

  it('content says same when today high equals yesterday high', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeResponse({ ydayHigh: 22.0, todayHigh: 22.0 }),
    ));

    const result = await morningGreeting.execute();
    if (!('summarize' in result)) return;
    expect(result.summarize.content).toContain('same high as yesterday');
  });

  it('rounds temperature correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeResponse({ nowTemp: 18.7, todayHigh: 21.6, todayLow: 14.4 }),
    ));

    const result = await morningGreeting.execute();
    if (!('summarize' in result)) return;
    expect(result.summarize.content).toContain('19°C'); // now temp
    expect(result.summarize.content).toContain('22°C'); // today high
    expect(result.summarize.content).toContain('14°C'); // today low
  });

  it('handles null rain chance gracefully (treats as 0%)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeResponse({ rainChance: null }),
    ));

    const result = await morningGreeting.execute();
    if (!('summarize' in result)) return;
    expect(result.summarize.content).toContain('0%');
    expect(result.summarize.fallback).not.toContain('umbrella');
  });

  it('throws when Open-Meteo returns a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(morningGreeting.execute()).rejects.toThrow('Open-Meteo API error: 503');
  });

  it('request URL includes all required current and daily variables', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse());
    vi.stubGlobal('fetch', fetchMock);

    await morningGreeting.execute();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('current=');
    expect(url).toContain('apparent_temperature');
    expect(url).toContain('relative_humidity_2m');
    expect(url).toContain('wind_speed_10m');
    expect(url).toContain('daily=');
    expect(url).toContain('precipitation_probability_max');
    expect(url).toContain('past_days=1');
    expect(url).toContain('forecast_days=1');
  });

  it('uses LATITUDE and LONGITUDE env vars in the request URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeResponse());
    vi.stubGlobal('fetch', fetchMock);

    process.env.LATITUDE = '35.6762';
    process.env.LONGITUDE = '139.6503';

    await morningGreeting.execute();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('latitude=35.6762');
    expect(url).toContain('longitude=139.6503');

    delete process.env.LATITUDE;
    delete process.env.LONGITUDE;
  });
});
