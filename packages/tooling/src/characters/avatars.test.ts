import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { loadAvatarManifest, prepareAvatarRun, readAvatarState } from './avatars.js';
import type { CardInput, Verdict } from './classify.js';

const BYTES = Buffer.from([1, 2, 3, 250, 251]);
const HASH = createHash('sha256').update(BYTES).digest('hex');

let dir: string;
let manifestPath: string;
let statePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'avatars-test-'));
  manifestPath = join(dir, 'AVATARS.json');
  statePath = join(dir, 'state.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function card(slug: string): CardInput {
  return { slug, file: `${slug}.json`, payload: { slug, name: slug } };
}

function writeManifest(value: unknown): void {
  writeFileSync(manifestPath, JSON.stringify(value), 'utf-8');
}

describe('loadAvatarManifest', () => {
  it('loads a flat slug -> path object, paths with spaces intact', () => {
    writeManifest({ aria: 'OC/some folder/aria v2.jpeg', 'bria-2': 'b.png' });

    const manifest = loadAvatarManifest(manifestPath);

    expect(manifest.get('aria')).toBe('OC/some folder/aria v2.jpeg');
    expect(manifest.size).toBe(2);
  });

  it('throws when the file cannot be read', () => {
    expect(() => loadAvatarManifest(join(dir, 'nope.json'))).toThrow('--avatars: cannot read');
  });

  it('throws on invalid JSON', () => {
    writeFileSync(manifestPath, '{nope', 'utf-8');
    expect(() => loadAvatarManifest(manifestPath)).toThrow('is not valid JSON');
  });

  it.each([
    ['array', []],
    ['null', null],
    ['string', 'x'],
  ])('throws when the top level is %s', (_label, value) => {
    writeManifest(value);
    expect(() => loadAvatarManifest(manifestPath)).toThrow('must be a JSON object');
  });

  it('throws on a key that is not a valid slug, naming the key', () => {
    writeManifest({ 'Not A Slug': 'a.png' });
    expect(() => loadAvatarManifest(manifestPath)).toThrow('offending key: Not A Slug');
  });

  it('throws on a too-short slug key', () => {
    writeManifest({ a: 'a.png' });
    expect(() => loadAvatarManifest(manifestPath)).toThrow('every key must be a valid slug');
  });

  it.each([
    ['empty string', ''],
    ['number', 5],
    ['null', null],
    ['object', {}],
  ])('throws on a %s value, naming the key', (_label, value) => {
    writeManifest({ aria: value });
    expect(() => loadAvatarManifest(manifestPath)).toThrow('(key: aria)');
  });
});

describe('readAvatarState', () => {
  it('reads a missing file as empty', () => {
    expect(readAvatarState(statePath)).toEqual({});
  });

  it('reads a malformed file as empty', () => {
    writeFileSync(statePath, '{broken', 'utf-8');
    expect(readAvatarState(statePath)).toEqual({});
  });

  it('warns naming the state path when the file is unreadable', () => {
    writeFileSync(statePath, '{broken', 'utf-8');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    readAvatarState(statePath);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain(statePath);
  });

  it('keeps only string hashes under object-valued envs', () => {
    writeFileSync(
      statePath,
      JSON.stringify({ dev: { aria: 'abc', bad: 5 }, prod: 'nope', local: [] }),
      'utf-8'
    );
    expect(readAvatarState(statePath)).toEqual({ dev: { aria: 'abc' } });
  });
});

describe('prepareAvatarRun', () => {
  it('returns null and prints when the manifest is invalid', () => {
    writeManifest([]);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(prepareAvatarRun(manifestPath, 'dev', [card('aria')], statePath)).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('must be a JSON object'));
  });

  it('injects bare base64 only for manifest slugs whose hash is new', () => {
    writeManifest({ aria: 'aria.png' });
    writeFileSync(join(dir, 'aria.png'), BYTES);

    const run = prepareAvatarRun(manifestPath, 'dev', [card('aria'), card('bria')], statePath);

    expect(run?.cards[0].payload.avatarData).toBe(BYTES.toString('base64'));
    expect(run?.cards[1].payload).toEqual({ slug: 'bria', name: 'bria' });
  });

  it('does not mutate the original card payload', () => {
    writeManifest({ aria: 'aria.png' });
    writeFileSync(join(dir, 'aria.png'), BYTES);
    const original = card('aria');

    prepareAvatarRun(manifestPath, 'dev', [original], statePath);

    expect(original.payload).not.toHaveProperty('avatarData');
  });

  it('skips injection when the recorded hash for this env equals the file hash', () => {
    writeManifest({ aria: 'aria.png' });
    writeFileSync(join(dir, 'aria.png'), BYTES);
    writeFileSync(statePath, JSON.stringify({ dev: { aria: HASH } }), 'utf-8');

    const run = prepareAvatarRun(manifestPath, 'dev', [card('aria')], statePath);

    expect(run?.cards[0].payload).not.toHaveProperty('avatarData');
  });

  it('injects when the hash is recorded only under a different env', () => {
    writeManifest({ aria: 'aria.png' });
    writeFileSync(join(dir, 'aria.png'), BYTES);
    writeFileSync(statePath, JSON.stringify({ prod: { aria: HASH } }), 'utf-8');

    const run = prepareAvatarRun(manifestPath, 'dev', [card('aria')], statePath);

    expect(run?.cards[0].payload.avatarData).toBe(BYTES.toString('base64'));
  });

  it('injects when the recorded hash differs from the file hash', () => {
    writeManifest({ aria: 'aria.png' });
    writeFileSync(join(dir, 'aria.png'), BYTES);
    writeFileSync(statePath, JSON.stringify({ dev: { aria: 'old' } }), 'utf-8');

    const run = prepareAvatarRun(manifestPath, 'dev', [card('aria')], statePath);

    expect(run?.cards[0].payload.avatarData).toBe(BYTES.toString('base64'));
  });

  it('refuses a missing image, an empty image, a directory, and an escaping path', () => {
    mkdirSync(join(dir, 'isdir'));
    writeFileSync(join(dir, 'empty.png'), Buffer.alloc(0));
    writeManifest({
      aria: 'missing.png',
      bria: 'empty.png',
      cora: 'isdir',
      dina: '../escape.png',
    });
    const cards = ['aria', 'bria', 'cora', 'dina'].map(card);
    const classified: Verdict[] = cards.map(() => ({ kind: 'new' }));

    const run = prepareAvatarRun(manifestPath, 'dev', cards, statePath);
    const verdicts = run?.applyRefusals(classified) ?? [];

    expect(verdicts).toEqual([
      { kind: 'refused', reason: 'avatar image not found: missing.png' },
      { kind: 'refused', reason: 'avatar image is empty: empty.png' },
      { kind: 'refused', reason: 'avatar image not found: isdir' },
      { kind: 'refused', reason: 'avatar image path leaves the manifest directory: ../escape.png' },
    ]);
  });

  it('accepts an in-tree path whose first segment merely begins with two dots', () => {
    mkdirSync(join(dir, '..hidden'));
    writeFileSync(join(dir, '..hidden', 'a.png'), BYTES);
    writeManifest({ aria: '..hidden/a.png' });

    const run = prepareAvatarRun(manifestPath, 'dev', [card('aria')], statePath);

    expect(run?.cards[0].payload.avatarData).toBe(BYTES.toString('base64'));
    expect(run?.applyRefusals([{ kind: 'new' }])).toEqual([{ kind: 'new' }]);
  });

  it('refuses an oversized image for that card only; the rest of the batch still plans', () => {
    writeFileSync(join(dir, 'big.png'), Buffer.alloc(14_000_001));
    writeFileSync(join(dir, 'ok.png'), BYTES);
    writeManifest({ aria: 'big.png', bria: 'ok.png' });
    const cards = [card('aria'), card('bria')];
    const classified: Verdict[] = [{ kind: 'new' }, { kind: 'new' }];

    const run = prepareAvatarRun(manifestPath, 'dev', cards, statePath);
    const verdicts = run?.applyRefusals(classified) ?? [];

    expect(verdicts[0]).toEqual({
      kind: 'refused',
      reason: expect.stringContaining('the gateway JSON body limit is 20mb'),
    });
    expect(verdicts[1]).toEqual({ kind: 'new' });
    expect(run?.cards[0].payload).not.toHaveProperty('avatarData');
    expect(run?.cards[1].payload.avatarData).toBe(BYTES.toString('base64'));
  });

  it('refuses an oversized image even when its hash matches the recorded state', () => {
    const big = Buffer.alloc(14_000_001);
    writeFileSync(join(dir, 'big.png'), big);
    writeManifest({ aria: 'big.png' });
    const bigHash = createHash('sha256').update(big).digest('hex');
    writeFileSync(statePath, JSON.stringify({ dev: { aria: bigHash } }), 'utf-8');
    const cards = [card('aria')];

    const run = prepareAvatarRun(manifestPath, 'dev', cards, statePath);
    const verdicts = run?.applyRefusals([{ kind: 'new' }]) ?? [];
    const resent = run?.resendForNewRows(verdicts) ?? [];

    expect(verdicts[0]).toEqual({
      kind: 'refused',
      reason: expect.stringContaining('the gateway JSON body limit is 20mb'),
    });
    expect(resent[0].payload).not.toHaveProperty('avatarData');
  });

  it('persist leaves no temp file behind after the atomic write', () => {
    writeManifest({ aria: 'aria.png' });
    writeFileSync(join(dir, 'aria.png'), BYTES);
    const cards = [card('aria')];

    const run = prepareAvatarRun(manifestPath, 'dev', cards, statePath);
    run?.onWritten(cards[0]);
    run?.persist();

    expect(JSON.parse(readFileSync(statePath, 'utf-8'))).toEqual({ dev: { aria: HASH } });
    expect(existsSync(`${statePath}.tmp`)).toBe(false);
  });

  it('printSummary counts apply only for cards that will be written, and prints the state path', () => {
    writeFileSync(join(dir, 'aria.png'), BYTES);
    writeManifest({ aria: 'aria.png', bria: 'aria.png', cora: 'aria.png' });
    const cards = [card('aria'), card('bria'), card('cora')];
    const verdicts: Verdict[] = [
      { kind: 'new' },
      { kind: 'unchanged', targetSlug: 'bria', ignored: [] },
      { kind: 'refused', reason: 'other' },
    ];
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    prepareAvatarRun(manifestPath, 'dev', cards, statePath)?.printSummary(verdicts);

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain(
      '3 manifest entries among selected cards (1 apply, 0 unchanged, 0 refused)'
    );
    expect(output).toContain(`Avatar state: ${resolve(statePath)}`);
  });

  it('keeps the classifier verdict for non-refused cards', () => {
    writeManifest({ aria: 'aria.png' });
    writeFileSync(join(dir, 'aria.png'), BYTES);
    const classified: Verdict[] = [{ kind: 'new' }, { kind: 'refused', reason: 'other' }];

    const run = prepareAvatarRun(manifestPath, 'dev', [card('aria'), card('bria')], statePath);

    expect(run?.applyRefusals(classified)).toEqual(classified);
  });

  it('persist writes hashes only for written avatar cards and merges existing state', () => {
    writeManifest({ aria: 'aria.png', bria: 'aria.png' });
    writeFileSync(join(dir, 'aria.png'), BYTES);
    writeFileSync(
      statePath,
      JSON.stringify({ dev: { zed: 'keep' }, prod: { aria: 'p' } }),
      'utf-8'
    );
    const cards = [card('aria'), card('bria'), card('cora')];

    const run = prepareAvatarRun(manifestPath, 'dev', cards, statePath);
    run?.onWritten(cards[0]);
    run?.onWritten(cards[2]);
    run?.persist();

    expect(JSON.parse(readFileSync(statePath, 'utf-8'))).toEqual({
      dev: { zed: 'keep', aria: HASH },
      prod: { aria: 'p' },
    });
  });

  it('persist writes nothing when no avatar was written', () => {
    writeManifest({ aria: 'aria.png' });
    writeFileSync(join(dir, 'aria.png'), BYTES);

    const run = prepareAvatarRun(manifestPath, 'dev', [card('aria')], statePath);
    run?.persist();

    expect(() => readFileSync(statePath)).toThrow();
  });
});
