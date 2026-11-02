import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.config.js';

const merged = mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: ['src/**/*.{test,spec}.ts'],
    },
  })
);

// src/test here is this package's test-audit code, not test helpers, so the root
// config's blanket exclude must not hide it from coverage.
merged.test.coverage.exclude = merged.test.coverage.exclude.filter(
  (pattern: string) => pattern !== '**/test/**'
);

export default merged;
