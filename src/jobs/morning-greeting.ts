import type { Job, JobResult } from '../types.js';

/**
 * WMO Weather interpretation codes (subset).
 * Full list: https://open-meteo.com/en/docs#weathervariables
 */
export const WEATHER_CODES: Record<number, string> = {
  0:  'clear sky',
  1:  'mainly clear',
  2:  'partly cloudy',
  3:  'overcast',
  45: 'foggy',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'moderate drizzle',
  55: 'dense drizzle',
  61: 'slight rain',
  63: 'moderate rain',
  65: 'heavy rain',
  71: 'slight snow',
  73: 'moderate snow',
  75: 'heavy snow',
  80: 'slight rain showers',
  81: 'moderate rain showers',
  82: 'violent rain showers',
  95: 'thunderstorm',
  96: 'thunderstorm with slight hail',
  99: 'thunderstorm with heavy hail',
};

export function describeWeatherCode(code: number): string {
  return WEATHER_CODES[code] ?? `unknown condition (code ${code})`;
}

interface OpenMeteoResponse {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_gusts_10m: number;
  };
  // past_days=1 & forecast_days=1 → [0] = yesterday, [1] = today
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    apparent_temperature_max: number[];
    apparent_temperature_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max: (number | null)[];
    weather_code: number[];
  };
}

export const morningGreeting: Job = {
  id: 'morning-greeting',
  description: 'Daily 7am weather brief with rain outlook and temperature trend',
  schedule: '0 7 * * *',
  enabled: true,

  async execute(): Promise<JobResult> {
    const lat = process.env.LATITUDE ?? '25.0330';
    const lon = process.env.LONGITUDE ?? '121.5654';

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,precipitation_probability_max,weather_code` +
      `&past_days=1&forecast_days=1`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }

    const data = (await response.json()) as OpenMeteoResponse;

    // Current snapshot
    const nowTemp     = Math.round(data.current.temperature_2m);
    const nowFeels    = Math.round(data.current.apparent_temperature);
    const nowCondition = describeWeatherCode(data.current.weather_code);
    const nowHumidity = data.current.relative_humidity_2m;
    const nowWind     = Math.round(data.current.wind_speed_10m);
    const nowGusts    = Math.round(data.current.wind_gusts_10m);

    // Daily aggregates — daily[0] = yesterday, daily[1] = today
    const ydayHigh    = Math.round(data.daily.temperature_2m_max[0]);
    const todayHigh   = Math.round(data.daily.temperature_2m_max[1]);
    const todayLow    = Math.round(data.daily.temperature_2m_min[1]);
    const todayFeelsHigh = Math.round(data.daily.apparent_temperature_max[1]);
    const todayFeelsLow  = Math.round(data.daily.apparent_temperature_min[1]);
    const todayRainMm    = data.daily.precipitation_sum[1] ?? 0;
    const todayRainChance = data.daily.precipitation_probability_max[1] ?? 0;

    // Temperature trend vs yesterday
    const diff = todayHigh - ydayHigh;
    const tempTrend =
      diff > 0  ? `${diff}°C warmer than yesterday (yesterday's high: ${ydayHigh}°C)` :
      diff < 0  ? `${Math.abs(diff)}°C cooler than yesterday (yesterday's high: ${ydayHigh}°C)` :
                  `same high as yesterday (${ydayHigh}°C)`;

    const content = [
      `Now: ${nowTemp}°C (feels ${nowFeels}°C), ${nowCondition}, humidity ${nowHumidity}%, wind ${nowWind} km/h (gusts ${nowGusts} km/h)`,
      `Today: high ${todayHigh}°C / low ${todayLow}°C (feels like ${todayFeelsHigh}°C / ${todayFeelsLow}°C)`,
      `Rain: ${todayRainChance}% chance, ${todayRainMm.toFixed(1)} mm expected`,
      `Trend: ${tempTrend}`,
    ].join('\n');

    const umbrellaHint = todayRainChance >= 40 ? ' ☂️ Bring an umbrella!' : '';
    const trendEmoji = diff > 0 ? '🌡️🔺' : diff < 0 ? '🌡️🔻' : '🌡️';
    const fallback =
      `🌅 Good morning! It's ${nowCondition} and ${nowTemp}°C outside. ` +
      `Today's range: ${todayLow}°C – ${todayHigh}°C. ` +
      `${trendEmoji} ${tempTrend}.` +
      `${umbrellaHint}`;

    return {
      summarize: {
        content,
        prompt:
          'You are Harold, a cheerful and enthusiastic personal assistant who LOVES mornings. ' +
          'The user has sent you a morning weather brief. ' +
          'Write an upbeat, emotionally expressive good morning message (2-3 sentences) that covers: ' +
          "today's temperature range (high and low), whether they should bring an umbrella, " +
          'and whether to dress warmer or lighter compared to yesterday. ' +
          'Use relevant weather emojis naturally throughout. Be warm, excitable, and fun — not robotic.',
        fallback: fallback.trim(),
      },
    };
  },
};
