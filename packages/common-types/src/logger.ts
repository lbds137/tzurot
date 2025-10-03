import { pino } from 'pino';
import type { Logger, LoggerOptions } from 'pino';

/**
 * Creates a logger instance with environment-aware configuration.
 * Uses pino-pretty transport ONLY when explicitly enabled via ENABLE_PRETTY_LOGS=true.
 * Defaults to plain JSON logging for production compatibility.
 */
export function createLogger(name?: string): Logger {
  const usePrettyLogs = process.env.ENABLE_PRETTY_LOGS === 'true';

  const config: LoggerOptions = {
    level: process.env.LOG_LEVEL || 'info',
    name,
  };

  // Only use pino-pretty when explicitly enabled (requires pino-pretty to be installed)
  if (usePrettyLogs) {
    config.transport = {
      target: 'pino-pretty',
      options: { colorize: true },
    };
  }

  return pino(config);
}
