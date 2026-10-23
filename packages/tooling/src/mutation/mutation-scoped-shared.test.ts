import { describe, it, expect } from 'vitest';
import { DEFAULT_BASE } from './mutation-scoped-shared.js';

describe('DEFAULT_BASE', () => {
  it('pins the shared base ref both the command default and the runner fallback ship', () => {
    // The value is a documented contract (OPS_CLI_REFERENCE.md names it as the
    // `--base` default); the command option (commands/test.ts) and the runner
    // fallback (mutation-scoped.ts) both read it from this module.
    expect(DEFAULT_BASE).toBe('origin/develop');
  });
});
