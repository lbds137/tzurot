import pino from 'pino';

/**
 * Creates a logger instance with environment-aware configuration.
 * Uses pino-pretty transport in development for readable logs,
 * plain JSON logging in production for performance and compatibility.
 */
export function createLogger(name?: string): pino.Logger {
  const isDevelopment = process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'dev';

  const config: pino.LoggerOptions = {
    level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
    name,
  };

  // Only use pino-pretty in development (it's a dev dependency)
  if (isDevelopment) {
    config.transport = {
      target: 'pino-pretty',
      options: { colorize: true },
    };
  }

  return pino(config);
}
