import { describe, expect, it } from 'vitest';

import { DEFAULT_TELEMETRY_DAYS } from './defaults.js';

describe('DEFAULT_TELEMETRY_DAYS', () => {
  it('pins the shared 30-day default the discoverability and inference reports advertise', () => {
    expect(DEFAULT_TELEMETRY_DAYS).toBe(30);
  });
});
