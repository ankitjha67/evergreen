// Structured logger - replaces ad-hoc console.log across the codebase.
// Levels: debug < info < warn < error. JSON output when LOG_FORMAT=json.

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";
let jsonMode = process.env.LOG_FORMAT === "json";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function setJsonMode(enabled: boolean): void {
  jsonMode = enabled;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, msg: string, meta?: Record<string, unknown>): string {
  if (jsonMode) {
    return JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  }
  const ts = new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
  const prefix = `[${ts}] ${level.toUpperCase().padEnd(5)}`;
  const metaStr = meta ? " " + Object.entries(meta).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ") : "";
  return `${prefix} ${msg}${metaStr}`;
}

export function debug(msg: string, meta?: Record<string, unknown>): void {
  if (shouldLog("debug")) console.debug(formatMessage("debug", msg, meta));
}

export function info(msg: string, meta?: Record<string, unknown>): void {
  if (shouldLog("info")) console.info(formatMessage("info", msg, meta));
}

export function warn(msg: string, meta?: Record<string, unknown>): void {
  if (shouldLog("warn")) console.warn(formatMessage("warn", msg, meta));
}

export function error(msg: string, meta?: Record<string, unknown>): void {
  if (shouldLog("error")) console.error(formatMessage("error", msg, meta));
}

export const log = { debug, info, warn, error, setLogLevel, setJsonMode };
