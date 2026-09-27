import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseListFlag, loadAndValidateCards, type CharactersImportOptions } from './load-cards.js';

const DISTINCTIVE_INFO = 'ZZZ_NEVER_PRINT_THIS_CARD_TEXT_ZZZ';

const VALID_CARD = {
  name: 'Aria',
  slug: 'aria',
  characterInfo: DISTINCTIVE_INFO,
  personalityTraits: 'Curious, kind',
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'load-cards-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeCard(filename: string, data: Record<string, unknown>): void {
  writeFileSync(join(dir, filename), JSON.stringify(data), 'utf-8');
}

function baseOpts(overrides: Partial<CharactersImportOptions> = {}): CharactersImportOptions {
  return { env: 'dev', dir, ...overrides };
}

describe('parseListFlag', () => {
  it('splits a comma list into a trimmed, non-empty-entry set', () => {
    expect(parseListFlag(' a, b ,, c')).toEqual(new Set(['a', 'b', 'c']));
  });

  it('returns an empty set for undefined', () => {
    expect(parseListFlag(undefined)).toEqual(new Set());
  });
});

describe('loadAndValidateCards', () => {
  it('loads and builds a valid card', () => {
    writeCard('aria.json', VALID_CARD);

    const result = loadAndValidateCards(baseOpts());

    expect(result).not.toBeNull();
    expect(result?.cards).toHaveLength(1);
    expect(result?.cards[0].slug).toBe('aria');
  });

  it('fails the whole batch on a duplicate slug among selected files', () => {
    writeCard('a.json', VALID_CARD);
    writeCard('b.json', { ...VALID_CARD, name: 'Aria2' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = loadAndValidateCards(baseOpts());

    expect(result).toBeNull();
    errorSpy.mockRestore();
  });

  it('rejects two --rename-map entries mapping to the same target slug', () => {
    writeCard('aria.json', { ...VALID_CARD, slug: 'aria-new' });
    const renameMapPath = join(dir, 'rename-map.json');
    writeFileSync(
      renameMapPath,
      JSON.stringify({ 'aria-old-1': 'aria-new', 'aria-old-2': 'aria-new' }),
      'utf-8'
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = loadAndValidateCards(baseOpts({ renameMap: renameMapPath }));

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--rename-map: two entries map to aria-new')
    );
    errorSpy.mockRestore();
  });

  it('returns null with zero side effects for an unreadable --dir', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = loadAndValidateCards(baseOpts({ dir: join(dir, 'does-not-exist') }));

    expect(result).toBeNull();
    errorSpy.mockRestore();
  });

  it('CANARY: --only warns and skips (not fails) a parseable card with a non-string slug', () => {
    writeCard('aria.json', VALID_CARD);
    writeCard('noslug.json', { name: 'No Slug', characterInfo: 'x', personalityTraits: 'x' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = loadAndValidateCards(baseOpts({ only: 'aria' }));

    expect(result).not.toBeNull();
    expect(result?.cards).toHaveLength(1);
    expect(result?.cards[0].slug).toBe('aria');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('skipped (no string slug, cannot match --only): noslug.json')
    );
    warnSpy.mockRestore();
  });

  it('without --only, a card with a non-string slug still fails validation normally', () => {
    writeCard('aria.json', VALID_CARD);
    writeCard('noslug.json', { name: 'No Slug', characterInfo: 'x', personalityTraits: 'x' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = loadAndValidateCards(baseOpts());

    expect(result).toBeNull();
    errorSpy.mockRestore();
  });

  it('rejects a --rename-map slug shorter than SLUG_MIN_LENGTH', () => {
    writeCard('aria.json', { ...VALID_CARD, slug: 'aria-new' });
    const renameMapPath = join(dir, 'rename-map.json');
    writeFileSync(renameMapPath, JSON.stringify({ ab: 'aria-new' }), 'utf-8');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = loadAndValidateCards(baseOpts({ renameMap: renameMapPath }));

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '--rename-map: every key and value must be a valid slug (offending key: ab)'
      )
    );
    errorSpy.mockRestore();
  });

  it('loads a card from a nested subdirectory, and excludes a --rename-map file nested inside --dir', () => {
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'aria.json'), JSON.stringify(VALID_CARD), 'utf-8');
    const renameMapPath = join(dir, 'sub', 'rename-map.json');
    writeFileSync(renameMapPath, JSON.stringify({}), 'utf-8');

    const result = loadAndValidateCards(baseOpts({ renameMap: renameMapPath }));

    expect(result).not.toBeNull();
    expect(result?.cards).toHaveLength(1);
    expect(result?.cards[0].slug).toBe('aria');
  });
});
