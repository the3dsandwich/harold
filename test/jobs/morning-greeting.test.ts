import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  morningGreeting,
  describeWeatherCode,
  WEATHER_CODES,
} from '../../src/jobs/morning-greeting.js';

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

  it('returns formatted content with temperature and condition', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: { temperature_2m: 22.4, weathercode: 1 } }),
    }));

    const result = await morningGreeting.execute();

    expect(result.content).toBe('temperature: 22°C, condition: mainly clear');
  });

  it('rounds temperature correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: { temperature_2m: 18.7, weathercode: 2 } }),
    }));

    const result = await morningGreeting.execute();
    expect(result.content).toContain('19°C');
  });

  it('enables summarize with a Harold-persona prompt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: { temperature_2m: 25.0, weathercode: 0 } }),
    }));

    const result = await morningGreeting.execute();

    expect(result.summarize?.enabled).toBe(true);
    expect(result.summarize?.prompt).toContain('Harold');
  });

  it('throws when Open-Meteo returns a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }));

    await expect(morningGreeting.execute()).rejects.toThrow('Open-Meteo API error: 503');
  });

  it('uses LATITUDE and LONGITUDE env vars in the request URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ current: { temperature_2m: 10.0, weathercode: 3 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    process.env.LATITUDE = '35.6762';
    process.env.LONGITUDE = '139.6503';

    await morningGreeting.execute();

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('latitude=35.6762');
    expect(calledUrl).toContain('longitude=139.6503');

    delete process.env.LATITUDE;
    delete process.env.LONGITUDE;
  });
});
