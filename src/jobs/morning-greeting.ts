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
    weathercode: number;
  };
}

export const morningGreeting: Job = {
  id: 'morning-greeting',
  description: 'Daily 7am weather greeting',
  schedule: '0 7 * * *',
  enabled: true,

  async execute(): Promise<JobResult> {
    const lat = process.env.LATITUDE ?? '25.0330';
    const lon = process.env.LONGITUDE ?? '121.5654';

    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }

    const data = (await response.json()) as OpenMeteoResponse;
    const temp = Math.round(data.current.temperature_2m);
    const condition = describeWeatherCode(data.current.weathercode);

    return {
      content: `temperature: ${temp}°C, condition: ${condition}`,
      summarize: {
        enabled: true,
        prompt:
          'You are Harold, a friendly and concise personal assistant. ' +
          'The user has sent you a brief weather data snippet. ' +
          'Write a warm good morning message (1-2 sentences) that naturally ' +
          'incorporates the weather. Be conversational, not robotic.',
      },
    };
  },
};
