import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_EXPORT_FIXED_PATHS,
  ACCOUNT_EXPORT_SUPERUSER_ONLY_PATHS,
  buildExpectedExportManifest,
  resolveExportSchemaForPath,
  sanitizeExportFileStem,
  type ExpectedExportManifestInput,
} from './accountExportManifest.js';

describe('sanitizeExportFileStem', () => {
  it('leaves word characters, dots, and hyphens untouched', () => {
    expect(sanitizeExportFileStem('my-persona.v2')).toBe('my-persona.v2');
  });

  it('replaces disallowed characters with underscores', () => {
    expect(sanitizeExportFileStem('a b/c?d')).toBe('a_b_c_d');
  });

  it('replaces every disallowed character rather than collapsing to empty', () => {
    // Every rejected char maps to its own underscore — sanitization never
    // shrinks the string, so this does NOT hit the "unnamed" fallback.
    expect(sanitizeExportFileStem('???')).toBe('___');
  });

  it('falls back to "unnamed" for a genuinely empty stem', () => {
    expect(sanitizeExportFileStem('')).toBe('unnamed');
  });
});

describe('ACCOUNT_EXPORT_FIXED_PATHS / ACCOUNT_EXPORT_SUPERUSER_ONLY_PATHS', () => {
  it('carries every unconditional path buildAccountExportFiles writes', () => {
    expect(ACCOUNT_EXPORT_FIXED_PATHS).toContain('README.md');
    expect(ACCOUNT_EXPORT_FIXED_PATHS).toContain('personality-directory.json');
    expect(ACCOUNT_EXPORT_FIXED_PATHS).toContain('telemetry/command-events.json');
    expect(ACCOUNT_EXPORT_FIXED_PATHS.length).toBe(19);
  });

  it('names exactly the superuser-only admin-settings path', () => {
    expect(ACCOUNT_EXPORT_SUPERUSER_ONLY_PATHS).toEqual(['account/admin-settings.json']);
  });
});

const baseInput: ExpectedExportManifestInput = {
  directory: [],
  personas: [],
  characters: [],
  conversationCountsByPersonalityId: {},
  memoryCountsByPersonalityId: {},
  factCountsByPersonalityId: {},
  isSuperuser: false,
};

describe('buildExpectedExportManifest', () => {
  it('requires exactly the fixed paths when there is no other data, non-superuser', () => {
    const result = buildExpectedExportManifest(baseInput);
    expect(result.required).toEqual([...ACCOUNT_EXPORT_FIXED_PATHS].sort());
    expect(result.forbidden).toEqual(['account/admin-settings.json']);
  });

  it('includes the admin-settings path in required, not forbidden, for a superuser', () => {
    const result = buildExpectedExportManifest({ ...baseInput, isSuperuser: true });
    expect(result.required).toContain('account/admin-settings.json');
    expect(result.forbidden).toEqual([]);
  });

  it('derives persona file paths from name + id prefix', () => {
    const result = buildExpectedExportManifest({
      ...baseInput,
      personas: [{ id: '12345678-aaaa-bbbb-cccc-000000000001', name: 'Alex' }],
    });
    expect(result.required).toContain('personas/Alex-12345678.json');
    expect(result.required).toContain('personas/Alex-12345678.md');
  });

  it('derives character file paths from slug', () => {
    const result = buildExpectedExportManifest({
      ...baseInput,
      characters: [{ id: 'char-1', slug: 'my-character' }],
    });
    expect(result.required).toContain('characters/my-character.json');
    expect(result.required).toContain('characters/my-character.md');
  });

  it('derives foldered section paths only for personalityIds with count > 0', () => {
    const result = buildExpectedExportManifest({
      ...baseInput,
      directory: [{ id: 'p1', name: 'P1', slug: 'p1-slug' }],
      conversationCountsByPersonalityId: { p1: 3, p2: 0 },
      memoryCountsByPersonalityId: { p1: 0 },
      factCountsByPersonalityId: {},
    });
    expect(result.required).toContain('conversations/p1-slug.json');
    expect(result.required).toContain('conversations/p1-slug.md');
    expect(result.required.some(p => p.startsWith('memories/'))).toBe(false);
    expect(result.required.some(p => p.startsWith('facts/'))).toBe(false);
    expect(result.required.some(p => p.includes('p2'))).toBe(false);
  });

  it('falls back to unknown-<id8> stem when the personalityId is not in the directory', () => {
    const result = buildExpectedExportManifest({
      ...baseInput,
      conversationCountsByPersonalityId: { '99999999-aaaa-bbbb-cccc-000000000009': 1 },
    });
    expect(result.required).toContain('conversations/unknown-99999999.json');
  });

  it('dedupes when two different personalityIds sanitize to the same stem (slug collision)', () => {
    const result = buildExpectedExportManifest({
      ...baseInput,
      directory: [
        { id: 'p1', name: 'P1', slug: 'shared slug' },
        { id: 'p2', name: 'P2', slug: 'shared/slug' },
      ],
      memoryCountsByPersonalityId: { p1: 1, p2: 1 },
    });
    const memoryPaths = result.required.filter(p => p.startsWith('memories/'));
    expect(memoryPaths).toEqual(['memories/shared_slug.json', 'memories/shared_slug.md']);
  });

  it('returns sorted, deduplicated arrays', () => {
    const result = buildExpectedExportManifest(baseInput);
    expect(result.required).toEqual([...result.required].sort());
    expect(new Set(result.required).size).toBe(result.required.length);
  });
});

describe('resolveExportSchemaForPath', () => {
  it('resolves every fixed path to a defined schema', () => {
    for (const path of ACCOUNT_EXPORT_FIXED_PATHS) {
      if (!path.endsWith('.json')) {
        continue;
      }
      expect(resolveExportSchemaForPath(path)).toBeDefined();
    }
  });

  it('resolves the superuser-only path', () => {
    expect(resolveExportSchemaForPath('account/admin-settings.json')).toBeDefined();
  });

  it('resolves foldered section paths by prefix', () => {
    expect(resolveExportSchemaForPath('personas/alex-12345678.json')).toBeDefined();
    expect(resolveExportSchemaForPath('characters/my-character.json')).toBeDefined();
    expect(resolveExportSchemaForPath('conversations/some-slug.json')).toBeDefined();
    expect(resolveExportSchemaForPath('memories/some-slug.json')).toBeDefined();
    expect(resolveExportSchemaForPath('facts/some-slug.json')).toBeDefined();
  });

  it('returns undefined for an unrecognized path', () => {
    expect(resolveExportSchemaForPath('unexpected/path.json')).toBeUndefined();
  });
});
