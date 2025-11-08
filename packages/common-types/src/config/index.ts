/**
 * Config Barrel Export
 *
 * Re-exports runtime configuration (environment variables).
 */

export {
  envSchema,
  validateEnv,
  getConfig,
  resetConfig,
  createTestConfig,
  type EnvConfig,
} from './config.js';
