import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['src/**/*.{test,spec}.ts'],
      setupFiles: ['./src/test/setup.ts'],
    },
  })
);
