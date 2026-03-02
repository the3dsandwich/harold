const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return LEVELS[raw as Level] ?? LEVELS.info;
}

function log(level: Level, prefix: string, message: string): void {
  if (LEVELS[level] < currentLevel()) return;
  const ts = new Date().toISOString();
  const out = level === 'error' ? console.error : console.log;
  out(`${ts} [${level.toUpperCase()}] [${prefix}] ${message}`);
}

export const logger = {
  debug: (prefix: string, msg: string) => log('debug', prefix, msg),
  info:  (prefix: string, msg: string) => log('info',  prefix, msg),
  warn:  (prefix: string, msg: string) => log('warn',  prefix, msg),
  error: (prefix: string, msg: string) => log('error', prefix, msg),
};
