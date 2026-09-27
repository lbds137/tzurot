import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildImportPayload } from '@tzurot/common-types/utils/characterImportPayload';
import { charactersImport } from './import.js';
import type { CharactersImportOptions } from './load-cards.js';
import { requireProductionConfirmation } from '../utils/env-runner.js';

vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
  requireProductionConfirmation: vi.fn().mockResolvedValue(undefined),
}));

const mockRequireProductionConfirmation = vi.mocked(requireProductionConfirmation);

const ACTOR = '900000000000000001';
const OTHER_USER = '900000000000000002';
const DISTINCTIVE_INFO = 'ZZZ_NEVER_PRINT_THIS_CARD_TEXT_ZZZ';

const VALID_CARD = {
  name: 'Aria',
  slug: 'aria',
  characterInfo: DISTINCTIVE_INFO,
  personalityTraits: 'Curious, kind',
};

function summary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Aria',
    displayName: 'Aria',
    slug: 'aria',
    isOwned: true,
    isPublic: false,
    ownerId: 'owner-uuid',
    ownerDiscordId: ACTOR,
    tags: [],
    permissions: { canEdit: true, canDelete: true },
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Aria',
    slug: 'aria',
    displayName: 'Aria',
    characterInfo: DISTINCTIVE_INFO,
    personalityTraits: 'Curious, kind',
    personalityTone: null,
    personalityAge: null,
    personalityAppearance: null,
    personalityLikes: null,
    personalityDislikes: null,
    conversationalGoals: null,
    conversationalExamples: null,
    errorMessage: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    isPublic: false,
    definitionPublic: false,
    definitionRedacted: false,
    voiceEnabled: false,
    imageEnabled: false,
    ownerId: 'owner-uuid',
    hasAvatar: false,
    avatarUrl: null,
    hasVoiceReference: false,
    customFields: null,
    tags: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface FakeClient {
  listPersonalities: ReturnType<typeof vi.fn>;
  getPersonality: ReturnType<typeof vi.fn>;
  createPersonality: ReturnType<typeof vi.fn>;
  updatePersonality: ReturnType<typeof vi.fn>;
}

function makeFakeClient(personalities: Record<string, unknown>[] = []): FakeClient {
  return {
    listPersonalities: vi.fn().mockResolvedValue({ ok: true, data: { personalities } }),
    getPersonality: vi
      .fn()
      .mockResolvedValue({ ok: false, kind: 'http', status: 404, error: 'not found' }),
    createPersonality: vi.fn().mockResolvedValue({ ok: true, data: { success: true } }),
    updatePersonality: vi.fn().mockResolvedValue({ ok: true, data: { success: true } }),
  };
}

/** Wire a fake client's getPersonality to return a row for the given slugs
 *  and 404 for everything else. */
function withRows(client: FakeClient, rows: Record<string, Record<string, unknown>>): void {
  client.getPersonality.mockImplementation((slug: string) => {
    const found = rows[slug];
    return Promise.resolve(
      found !== undefined
        ? { ok: true, data: { personality: found, canEdit: true } }
        : { ok: false, kind: 'http', status: 404, error: 'not found' }
    );
  });
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'characters-import-test-'));
  process.exitCode = undefined;
  mockRequireProductionConfirmation.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

function writeCard(filename: string, data: Record<string, unknown>): void {
  writeFileSync(join(dir, filename), JSON.stringify(data), 'utf-8');
}

function baseOpts(overrides: Partial<CharactersImportOptions> = {}): CharactersImportOptions {
  return { env: 'dev', dir, ...overrides };
}

describe('charactersImport', () => {
  it('CANARY-1: creates a new card with exactly buildImportPayload output', async () => {
    writeCard('aria.json', VALID_CARD);
    const client = makeFakeClient([]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });

    await charactersImport(baseOpts({ apply: true }), { getUserClient });

    const expectedPayload = {
      name: 'Aria',
      slug: 'aria',
      characterInfo: DISTINCTIVE_INFO,
      personalityTraits: 'Curious, kind',
      displayName: undefined,
      isPublic: false,
      definitionPublic: false,
      personalityTone: undefined,
      personalityAge: undefined,
      personalityAppearance: undefined,
      personalityLikes: undefined,
      personalityDislikes: undefined,
      conversationalGoals: undefined,
      conversationalExamples: undefined,
      customFields: undefined,
      tags: undefined,
      avatarData: undefined,
      voiceReferenceData: undefined,
      voiceEnabled: undefined,
      errorMessage: undefined,
    };
    expect(client.createPersonality).toHaveBeenCalledWith(expectedPayload);
    expect(client.createPersonality).toHaveBeenCalledWith(
      buildImportPayload(VALID_CARD, 'aria', undefined, undefined)
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('CANARY-2: an invalid card among selected files aborts with zero gateway calls, even with --apply', async () => {
    writeCard('aria.json', VALID_CARD);
    writeCard('bad.json', { name: 'Bad', slug: 'bad' }); // missing characterInfo/personalityTraits
    const client = makeFakeClient([]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await charactersImport(baseOpts({ apply: true }), { getUserClient });

    expect(process.exitCode).toBe(1);
    expect(getUserClient).not.toHaveBeenCalled();
    expect(client.listPersonalities).not.toHaveBeenCalled();
    expect(client.getPersonality).not.toHaveBeenCalled();
    expect(client.createPersonality).not.toHaveBeenCalled();
    expect(client.updatePersonality).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('invalid JSON in the directory aborts with zero gateway calls', async () => {
    writeCard('aria.json', VALID_CARD);
    writeFileSync(join(dir, 'broken.json'), '{ not valid json', 'utf-8');
    const client = makeFakeClient([]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await charactersImport(baseOpts({ apply: true }), { getUserClient });

    expect(process.exitCode).toBe(1);
    expect(getUserClient).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('CANARY-4: a foreign-owned existing slug refuses, blocking apply and skipping its write', async () => {
    writeCard('aria.json', VALID_CARD);
    const client = makeFakeClient([summary({ ownerDiscordId: OTHER_USER })]);
    withRows(client, { aria: row() });
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await charactersImport(baseOpts({ apply: true }), { getUserClient });

    expect(process.exitCode).toBe(1);
    expect(client.updatePersonality).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('CANARY-4: --allow-foreign permits the update to go through', async () => {
    writeCard('aria.json', VALID_CARD);
    const client = makeFakeClient([summary({ ownerDiscordId: OTHER_USER })]);
    withRows(client, { aria: row({ personalityTraits: 'a different trait entirely' }) });
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });

    await charactersImport(baseOpts({ apply: true, allowForeign: 'aria' }), { getUserClient });

    expect(client.updatePersonality).toHaveBeenCalledWith('aria', expect.any(Object));
    expect(process.exitCode).toBeUndefined();
  });

  it('CANARY-3: a duplicate-name create is refused and never created, even with --apply', async () => {
    writeCard('aria-two.json', { ...VALID_CARD, slug: 'aria-two' });
    const client = makeFakeClient([summary({ slug: 'aria', name: 'Aria' })]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await charactersImport(baseOpts({ apply: true }), { getUserClient });

    expect(process.exitCode).toBe(1);
    expect(client.createPersonality).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('a changed card updates via updatePersonality(slug, payload)', async () => {
    writeCard('aria.json', VALID_CARD);
    const client = makeFakeClient([summary()]);
    withRows(client, { aria: row({ personalityTraits: 'a different trait entirely' }) });
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });

    await charactersImport(baseOpts({ apply: true }), { getUserClient });

    // Update path carries the shared builder's payload unchanged, like create.
    expect(client.updatePersonality).toHaveBeenCalledWith(
      'aria',
      buildImportPayload(VALID_CARD, 'aria', undefined, undefined)
    );
  });

  it('a rename updates the OLD slug with a payload carrying the new slug', async () => {
    writeCard('aria.json', { ...VALID_CARD, slug: 'aria-new' });
    const client = makeFakeClient([summary({ slug: 'aria-old' })]);
    withRows(client, { 'aria-old': row({ slug: 'aria-old' }) });
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    // The rename map lives OUTSIDE `dir` — `dir` is walked for `*.json` card
    // files, so a map file inside it would itself be picked up as a card.
    const configDir = mkdtempSync(join(tmpdir(), 'characters-import-config-'));
    const renameMapPath = join(configDir, 'rename-map.json');
    writeFileSync(renameMapPath, JSON.stringify({ 'aria-old': 'aria-new' }), 'utf-8');

    try {
      await charactersImport(baseOpts({ apply: true, renameMap: renameMapPath }), {
        getUserClient,
      });
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(client.updatePersonality).toHaveBeenCalledWith(
      'aria-old',
      expect.objectContaining({ slug: 'aria-new' })
    );
  });

  it('a rename-map file placed INSIDE --dir is skipped by the card scan, not read as a card', async () => {
    writeCard('aria.json', { ...VALID_CARD, slug: 'aria-new' });
    const renameMapPath = join(dir, 'rename-map.json');
    writeFileSync(renameMapPath, JSON.stringify({ 'aria-old': 'aria-new' }), 'utf-8');
    const client = makeFakeClient([summary({ slug: 'aria-old' })]);
    withRows(client, { 'aria-old': row({ slug: 'aria-old' }) });
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await charactersImport(baseOpts({ apply: true, renameMap: renameMapPath }), {
      getUserClient,
    });

    expect(process.exitCode).toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('failed validation'));
    expect(client.updatePersonality).toHaveBeenCalledWith(
      'aria-old',
      expect.objectContaining({ slug: 'aria-new' })
    );
    errorSpy.mockRestore();
  });

  it('dry run (no --apply) never writes', async () => {
    writeCard('aria.json', VALID_CARD);
    const client = makeFakeClient([]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });

    await charactersImport(baseOpts(), { getUserClient });

    expect(client.createPersonality).not.toHaveBeenCalled();
    expect(client.updatePersonality).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('the first write failure stops the batch and exits nonzero', async () => {
    writeCard('a-aria.json', { ...VALID_CARD, slug: 'a-aria' });
    // A distinct name — sharing VALID_CARD's name here would trip the
    // same-batch duplicate-name refusal this test isn't exercising.
    writeCard('b-kestrel.json', { ...VALID_CARD, slug: 'b-kestrel', name: 'Kestrel' });
    const client = makeFakeClient([]);
    client.createPersonality
      .mockResolvedValueOnce({ ok: false, kind: 'http', status: 500, error: 'boom' })
      .mockResolvedValueOnce({ ok: true, data: { success: true } });
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await charactersImport(baseOpts({ apply: true }), { getUserClient });

    expect(process.exitCode).toBe(1);
    expect(client.createPersonality).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('--only limits the imported set', async () => {
    writeCard('aria.json', VALID_CARD);
    writeCard('other.json', { ...VALID_CARD, slug: 'other', name: 'Other' });
    const client = makeFakeClient([]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });

    await charactersImport(baseOpts({ apply: true, only: 'aria' }), { getUserClient });

    expect(client.createPersonality).toHaveBeenCalledTimes(1);
    expect(client.createPersonality).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'aria' })
    );
  });

  it('CANARY: --only warns and skips (not fails) an unreadable/invalid-JSON sibling file', async () => {
    writeCard('aria.json', VALID_CARD);
    writeFileSync(join(dir, 'broken.json'), '{ not valid json', 'utf-8');
    const client = makeFakeClient([]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await charactersImport(baseOpts({ apply: true, only: 'aria' }), { getUserClient });

    expect(process.exitCode).toBeUndefined();
    expect(client.createPersonality).toHaveBeenCalledTimes(1);
    expect(client.createPersonality).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'aria' })
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('skipped (unreadable/invalid JSON, cannot match --only): broken.json')
    );
    warnSpy.mockRestore();
  });

  it('CANARY: a nonexistent --dir prints an error and makes zero client calls', async () => {
    const client = makeFakeClient([]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await charactersImport(baseOpts({ dir: join(dir, 'does-not-exist'), apply: true }), {
      getUserClient,
    });

    expect(process.exitCode).toBe(1);
    expect(getUserClient).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`--dir: cannot read ${join(dir, 'does-not-exist')}`)
    );
    errorSpy.mockRestore();
  });

  it('CANARY: a 403 GET refuses only that card, not the whole run', async () => {
    writeCard('aria.json', VALID_CARD);
    writeCard('kestrel.json', { ...VALID_CARD, slug: 'kestrel', name: 'Kestrel' });
    const client = makeFakeClient([]);
    client.getPersonality.mockImplementation((slug: string) =>
      Promise.resolve(
        slug === 'aria'
          ? { ok: false, kind: 'http', status: 403, error: 'forbidden' }
          : { ok: false, kind: 'http', status: 404, error: 'not found' }
      )
    );
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // Dry run: proves the run reaches the report (not aborted before it),
    // since --apply would be blocked wholesale by the refused card anyway.
    await charactersImport(baseOpts(), { getUserClient });

    const lines = logSpy.mock.calls.map(call => call.join(' '));
    expect(
      lines.some(l => l.includes('aria') && l.includes('not visible to the acting user'))
    ).toBe(true);
    expect(lines.some(l => l.includes('kestrel') && l.includes('new'))).toBe(true);
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Failed to fetch'));
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('a non-403 GET failure still aborts the whole run', async () => {
    writeCard('aria.json', VALID_CARD);
    const client = makeFakeClient([]);
    client.getPersonality.mockResolvedValue({
      ok: false,
      kind: 'http',
      status: 500,
      error: 'boom',
    });
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await charactersImport(baseOpts({ apply: true }), { getUserClient });

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch'));
    errorSpy.mockRestore();
  });

  it('CANARY: --rename-map rejects two entries mapping to the same target slug', async () => {
    writeCard('aria.json', { ...VALID_CARD, slug: 'aria-new' });
    const client = makeFakeClient([]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const configDir = mkdtempSync(join(tmpdir(), 'characters-import-config-'));
    const renameMapPath = join(configDir, 'rename-map.json');
    writeFileSync(
      renameMapPath,
      JSON.stringify({ 'aria-old-1': 'aria-new', 'aria-old-2': 'aria-new' }),
      'utf-8'
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await charactersImport(baseOpts({ renameMap: renameMapPath }), { getUserClient });
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(process.exitCode).toBe(1);
    expect(getUserClient).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--rename-map: two entries map to aria-new')
    );
    errorSpy.mockRestore();
  });

  it('CANARY: a rename by a non-owner is refused, blocking apply', async () => {
    writeCard('aria.json', { ...VALID_CARD, slug: 'aria-new' });
    const client = makeFakeClient([summary({ slug: 'aria-old' })]);
    withRows(client, { 'aria-old': row({ slug: 'aria-old' }) });
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: false });
    const configDir = mkdtempSync(join(tmpdir(), 'characters-import-config-'));
    const renameMapPath = join(configDir, 'rename-map.json');
    writeFileSync(renameMapPath, JSON.stringify({ 'aria-old': 'aria-new' }), 'utf-8');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await charactersImport(baseOpts({ apply: true, renameMap: renameMapPath }), {
        getUserClient,
      });
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }

    expect(process.exitCode).toBe(1);
    expect(client.updatePersonality).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('a 500-row list is a fatal abort with no writes', async () => {
    writeCard('aria.json', VALID_CARD);
    const bigList = Array.from({ length: 500 }, (_, i) => summary({ slug: `char-${String(i)}` }));
    const client = makeFakeClient(bigList);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await charactersImport(baseOpts({ apply: true }), { getUserClient });

    expect(process.exitCode).toBe(1);
    expect(client.getPersonality).not.toHaveBeenCalled();
    expect(client.createPersonality).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('CANARY: a non-owner run aborts with zero writes when private summaries are at the 100-row cap', async () => {
    writeCard('aria.json', VALID_CARD);
    const ownedList = Array.from({ length: 100 }, (_, i) =>
      summary({
        slug: `char-${String(i)}`,
        name: `Char ${String(i)}`,
        displayName: `Char ${String(i)}`,
        ownerDiscordId: ACTOR,
      })
    );
    const client = makeFakeClient(ownedList);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: false });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await charactersImport(baseOpts({ apply: true }), { getUserClient });

    expect(process.exitCode).toBe(1);
    expect(client.getPersonality).not.toHaveBeenCalled();
    expect(client.createPersonality).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('CANARY: a non-owner with 150 public owned rows and 5 private rows does not abort (the cap counts PRIVATE rows, not owned rows)', async () => {
    writeCard('aria.json', VALID_CARD);
    const publicOwnedList = Array.from({ length: 150 }, (_, i) =>
      summary({
        slug: `pub-${String(i)}`,
        name: `Pub ${String(i)}`,
        displayName: `Pub ${String(i)}`,
        ownerDiscordId: ACTOR,
        isPublic: true,
      })
    );
    const privateList = Array.from({ length: 5 }, (_, i) =>
      summary({
        slug: `priv-${String(i)}`,
        name: `Priv ${String(i)}`,
        displayName: `Priv ${String(i)}`,
        ownerDiscordId: ACTOR,
        isPublic: false,
      })
    );
    const client = makeFakeClient([...publicOwnedList, ...privateList]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: false });

    await charactersImport(baseOpts({ apply: true }), { getUserClient });

    expect(process.exitCode).toBeUndefined();
    expect(client.createPersonality).toHaveBeenCalledTimes(1);
  });

  it('the bot owner is exempt from the non-owner roster cap at the same count', async () => {
    writeCard('aria.json', VALID_CARD);
    const ownedList = Array.from({ length: 100 }, (_, i) =>
      summary({
        slug: `char-${String(i)}`,
        name: `Char ${String(i)}`,
        displayName: `Char ${String(i)}`,
        ownerDiscordId: ACTOR,
      })
    );
    const client = makeFakeClient(ownedList);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });

    await charactersImport(baseOpts({ apply: true }), { getUserClient });

    expect(process.exitCode).toBeUndefined();
    expect(client.createPersonality).toHaveBeenCalledTimes(1);
  });

  it('never prints a card field value', async () => {
    writeCard('aria.json', VALID_CARD);
    const client = makeFakeClient([]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await charactersImport(baseOpts({ apply: true }), { getUserClient });

    const allOutput = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .join('\n');
    expect(allOutput).not.toContain(DISTINCTIVE_INFO);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('CANARY: --apply --env prod without --force asks for confirmation before any write', async () => {
    writeCard('aria.json', VALID_CARD);
    const client = makeFakeClient([]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });
    const callOrder: string[] = [];
    mockRequireProductionConfirmation.mockImplementation(async () => {
      callOrder.push('confirm');
    });
    client.createPersonality.mockImplementation(async () => {
      callOrder.push('create');
      return { ok: true, data: { success: true } };
    });

    await charactersImport(baseOpts({ env: 'prod', apply: true }), { getUserClient });

    expect(mockRequireProductionConfirmation).toHaveBeenCalledTimes(1);
    expect(mockRequireProductionConfirmation).toHaveBeenCalledWith(
      'write character cards to production'
    );
    expect(callOrder).toEqual(['confirm', 'create']);
    expect(process.exitCode).toBeUndefined();
  });

  it('--apply --env prod --force skips confirmation and writes', async () => {
    writeCard('aria.json', VALID_CARD);
    const client = makeFakeClient([]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });

    await charactersImport(baseOpts({ env: 'prod', apply: true, force: true }), {
      getUserClient,
    });

    expect(mockRequireProductionConfirmation).not.toHaveBeenCalled();
    expect(client.createPersonality).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeUndefined();
  });

  it('a dry run with --env prod never asks for confirmation', async () => {
    writeCard('aria.json', VALID_CARD);
    const client = makeFakeClient([]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });

    await charactersImport(baseOpts({ env: 'prod' }), { getUserClient });

    expect(mockRequireProductionConfirmation).not.toHaveBeenCalled();
    expect(client.createPersonality).not.toHaveBeenCalled();
  });

  it('--apply --env dev never asks for confirmation', async () => {
    writeCard('aria.json', VALID_CARD);
    const client = makeFakeClient([]);
    const getUserClient = vi
      .fn()
      .mockReturnValue({ client, actingDiscordId: ACTOR, isBotOwner: true });

    await charactersImport(baseOpts({ env: 'dev', apply: true }), { getUserClient });

    expect(mockRequireProductionConfirmation).not.toHaveBeenCalled();
    expect(client.createPersonality).toHaveBeenCalledTimes(1);
  });
});
