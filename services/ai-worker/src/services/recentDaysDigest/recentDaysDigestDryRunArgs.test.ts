import { describe, it, expect } from 'vitest';

import { parseDryRunArgs } from './recentDaysDigestDryRunArgs.js';

describe('parseDryRunArgs', () => {
  it('parses both flags', () => {
    expect(parseDryRunArgs(['--persona', 'persona-1', '--personality', 'slug-1'])).toEqual({
      ok: true,
      personaId: 'persona-1',
      personalitySlug: 'slug-1',
    });
  });

  it('rejects a flag whose value is missing at the end of argv', () => {
    expect(parseDryRunArgs(['--personality', 'slug-1', '--persona'])).toEqual({
      ok: false,
      reason: 'missing value for --persona',
    });
  });

  it('rejects a flag whose next token is another flag', () => {
    expect(parseDryRunArgs(['--persona', '--personality', 'slug-1'])).toEqual({
      ok: false,
      reason: 'missing value for --persona',
    });
  });

  it('rejects an unrecognized token instead of ignoring it', () => {
    expect(parseDryRunArgs(['--persona', 'persona-1', '--personality', 'slug-1', '--dry'])).toEqual(
      {
        ok: false,
        reason: 'unrecognized argument: --dry',
      }
    );
  });

  it('rejects a missing --persona', () => {
    expect(parseDryRunArgs(['--personality', 'slug-1'])).toEqual({
      ok: false,
      reason: 'missing --persona',
    });
  });

  it('rejects a missing --personality', () => {
    expect(parseDryRunArgs(['--persona', 'persona-1'])).toEqual({
      ok: false,
      reason: 'missing --personality',
    });
  });

  it('takes the last value of a repeated flag', () => {
    expect(
      parseDryRunArgs([
        '--persona',
        'persona-1',
        '--persona',
        'persona-2',
        '--personality',
        'slug-1',
      ])
    ).toEqual({
      ok: true,
      personaId: 'persona-2',
      personalitySlug: 'slug-1',
    });
  });
});
