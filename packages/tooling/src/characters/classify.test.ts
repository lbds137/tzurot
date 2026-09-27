import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildImportPayload } from '@tzurot/common-types/utils/characterImportPayload';
import {
  classifyBatch,
  classifyCard,
  diffAgainstRow,
  SIMPLE_FIELDS,
  type CardInput,
  type ClassifyContext,
  type Row,
  type Summary,
} from './classify.js';

const ACTOR = '900000000000000001';
const OTHER_USER = '900000000000000002';

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Aria',
    slug: 'aria',
    displayName: 'Aria',
    characterInfo: 'A wandering bard.',
    personalityTraits: 'Curious, kind',
    personalityTone: 'friendly',
    personalityAge: '25',
    personalityAppearance: 'tall',
    personalityLikes: 'tea',
    personalityDislikes: 'noise',
    conversationalGoals: 'be helpful',
    conversationalExamples: 'Hi there!',
    errorMessage: null,
    birthMonth: null,
    birthDay: null,
    birthYear: null,
    isPublic: false,
    definitionPublic: false,
    definitionRedacted: false,
    voiceEnabled: false,
    imageEnabled: false,
    ownerId: 'owner-uuid-1',
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

function makeSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Aria',
    displayName: 'Aria',
    slug: 'aria',
    isOwned: true,
    isPublic: false,
    ownerId: 'owner-uuid-1',
    ownerDiscordId: ACTOR,
    tags: [],
    permissions: { canEdit: true, canDelete: true },
    ...overrides,
  };
}

function makeCard(
  cardOverrides: Record<string, unknown>,
  slug = 'aria',
  file = 'aria.json'
): CardInput {
  const payload = buildImportPayload({ ...cardOverrides, slug }, slug, undefined, undefined);
  return { slug, file, payload };
}

function makeContext(overrides: Partial<ClassifyContext> = {}): ClassifyContext {
  return {
    actingDiscordId: ACTOR,
    summaries: [],
    rowsBySlug: new Map(),
    renameMap: new Map(),
    createNew: new Set(),
    allowForeign: new Set(),
    isBotOwner: true,
    forbiddenSlugs: new Set(),
    ...overrides,
  };
}

const FULL_CARD_DATA = {
  name: 'Aria',
  characterInfo: 'A wandering bard.',
  personalityTraits: 'Curious, kind',
};

describe('SIMPLE_FIELDS drift', () => {
  it("matches the update route's own simpleFields array literal exactly", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const updateRoutePath = join(
      here,
      '../../../../services/api-gateway/src/routes/user/personality/update.ts'
    );
    const source = readFileSync(updateRoutePath, 'utf-8');
    const match = /const simpleFields:[^=]*=\s*\[([\s\S]*?)\]/.exec(source);
    const entries = match !== null ? [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];

    // No vacuous pass: a broken extraction (wrong path, changed literal
    // shape) must fail loudly rather than compare two empty sets.
    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(entries)).toEqual(new Set(SIMPLE_FIELDS));
  });
});

/** Narrows `diffAgainstRow`'s `DiffResult` to the `ok: true` branch for tests
 *  that exercise a payload the update schema accepts — the refusal branch has
 *  its own test below. */
function okDiff(
  payload: Record<string, unknown>,
  row: Row
): { fields: string[]; ignored: string[] } {
  const result = diffAgainstRow(payload, row);
  if (!result.ok) {
    throw new Error(`expected an accepted diff, got refused: ${result.reason}`);
  }
  return result;
}

describe('diffAgainstRow', () => {
  it('reports no fields when the payload equals the row', () => {
    const row = makeRow();
    const payload = buildImportPayload(FULL_CARD_DATA, 'aria', undefined, undefined);

    const { fields, ignored } = okDiff(payload, row);

    expect(fields).toEqual([]);
    expect(ignored).toEqual([]);
  });

  it('whitespace-only difference in a nullableString field is unchanged (trim)', () => {
    const row = makeRow({ personalityTone: 'friendly' });
    const payload = buildImportPayload(
      { ...FULL_CARD_DATA, personalityTone: '  friendly  ' },
      'aria',
      undefined,
      undefined
    );

    expect(okDiff(payload, row).fields).toEqual([]);
  });

  it("'' vs null is unchanged", () => {
    const row = makeRow({ personalityTone: null });
    const payload = buildImportPayload(
      { ...FULL_CARD_DATA, personalityTone: '' },
      'aria',
      undefined,
      undefined
    );

    expect(okDiff(payload, row).fields).toEqual([]);
  });

  it('changed lists exactly the differing field names', () => {
    const row = makeRow({ personalityTone: 'grumpy', personalityLikes: 'silence' });
    const payload = buildImportPayload(
      { ...FULL_CARD_DATA, personalityTone: 'cheerful', personalityLikes: 'silence' },
      'aria',
      undefined,
      undefined
    );

    expect(okDiff(payload, row).fields).toEqual(['personalityTone']);
  });

  it('CANARY-5: a card missing personalityAge does not report it, even when the row has one', () => {
    const row = makeRow({ personalityAge: '99' });
    const payload = buildImportPayload(FULL_CARD_DATA, 'aria', undefined, undefined);

    expect(okDiff(payload, row).fields).not.toContain('personalityAge');
  });

  it('displayName: card without displayName where row.displayName === row.name is unchanged', () => {
    const row = makeRow({ name: 'Aria', displayName: 'Aria' });
    const payload = buildImportPayload(
      { ...FULL_CARD_DATA, name: 'Aria' },
      'aria',
      undefined,
      undefined
    );

    expect(okDiff(payload, row).fields).not.toContain('displayName');
  });

  it('displayName: row.displayName differs from name, card has no displayName -> reported', () => {
    const row = makeRow({ name: 'Aria', displayName: 'Custom Display' });
    const payload = buildImportPayload(
      { ...FULL_CARD_DATA, name: 'Aria' },
      'aria',
      undefined,
      undefined
    );

    expect(okDiff(payload, row).fields).toContain('displayName');
  });

  it('isPublic differs -> reported in ignored, not fields', () => {
    const row = makeRow({ isPublic: false });
    const payload = buildImportPayload(
      { ...FULL_CARD_DATA, isPublic: true },
      'aria',
      undefined,
      undefined
    );

    const { fields, ignored } = okDiff(payload, row);
    expect(fields).not.toContain('isPublic');
    expect(ignored).toContain('isPublic');
  });

  it('avatarData / voiceReferenceData are always reported as changed when present', () => {
    const row = makeRow();
    const payload = buildImportPayload(
      FULL_CARD_DATA,
      'aria',
      'new-avatar-base64',
      'new-voice-data-uri'
    );

    const { fields } = okDiff(payload, row);
    expect(fields).toContain('avatarData');
    expect(fields).toContain('voiceReferenceData');
  });

  it('tags and customFields compare by value', () => {
    const row = makeRow({ tags: ['fantasy'], customFields: { a: 1 } });
    const samePayload = buildImportPayload(
      { ...FULL_CARD_DATA, tags: ['fantasy'], customFields: { a: 1 } },
      'aria',
      undefined,
      undefined
    );
    const changedPayload = buildImportPayload(
      { ...FULL_CARD_DATA, tags: ['fantasy', 'sci-fi'], customFields: { a: 2 } },
      'aria',
      undefined,
      undefined
    );

    expect(okDiff(samePayload, row).fields).toEqual([]);
    const { fields } = okDiff(changedPayload, row);
    expect(fields).toContain('tags');
    expect(fields).toContain('customFields');
  });

  it('CANARY: a payload the update schema rejects is refused, not thrown', () => {
    const row = makeRow();
    // voiceEnabled must be boolean per PersonalityUpdateSchema — an invalid
    // type fails safeParse without touching any of the diff logic above.
    const payload = { ...FULL_CARD_DATA, slug: 'aria', voiceEnabled: 'not-a-boolean' };

    const result = diffAgainstRow(payload, row);

    expect(result).toEqual({
      ok: false,
      reason: expect.stringContaining('payload rejected by the update schema'),
    });
  });
});

describe('classifyCard', () => {
  it('is new when no row and no owned-name collision exists', () => {
    const card = makeCard(FULL_CARD_DATA);
    const ctx = makeContext();

    expect(classifyCard(card, ctx)).toEqual({ kind: 'new' });
  });

  it('CANARY-3: refuses a create matching an owned row by name (case-insensitive)', () => {
    const card = makeCard({ ...FULL_CARD_DATA, name: 'ARIA' }, 'aria-two');
    const ctx = makeContext({ summaries: [makeSummary({ slug: 'aria', name: 'Aria' })] });

    expect(classifyCard(card, ctx)).toEqual({ kind: 'refused', reason: 'duplicate of aria' });
  });

  it('CANARY-3: createNew overrides the duplicate-name refusal', () => {
    const card = makeCard({ ...FULL_CARD_DATA, name: 'ARIA' }, 'aria-two');
    const ctx = makeContext({
      summaries: [makeSummary({ slug: 'aria', name: 'Aria' })],
      createNew: new Set(['aria-two']),
    });

    expect(classifyCard(card, ctx)).toEqual({ kind: 'new' });
  });

  it('CANARY-3: a name match owned by someone else does not refuse', () => {
    const card = makeCard({ ...FULL_CARD_DATA, name: 'ARIA' }, 'aria-two');
    const ctx = makeContext({
      summaries: [makeSummary({ slug: 'aria', name: 'Aria', ownerDiscordId: OTHER_USER })],
    });

    expect(classifyCard(card, ctx)).toEqual({ kind: 'new' });
  });

  it('CANARY-4: refuses updating a row owned by another user', () => {
    const card = makeCard(FULL_CARD_DATA);
    const ctx = makeContext({
      summaries: [makeSummary({ ownerDiscordId: OTHER_USER })],
      rowsBySlug: new Map([['aria', makeRow()]]),
    });

    expect(classifyCard(card, ctx)).toEqual({ kind: 'refused', reason: 'owned by another user' });
  });

  it('CANARY-4: allowForeign permits updating a foreign-owned row', () => {
    const card = makeCard(FULL_CARD_DATA);
    const ctx = makeContext({
      summaries: [makeSummary({ ownerDiscordId: OTHER_USER })],
      rowsBySlug: new Map([['aria', makeRow()]]),
      allowForeign: new Set(['aria']),
    });

    expect(classifyCard(card, ctx)).toEqual({ kind: 'unchanged', targetSlug: 'aria', ignored: [] });
  });

  it('CANARY: refuses a card whose slug 403s (not visible to the acting user)', () => {
    const card = makeCard(FULL_CARD_DATA);
    const ctx = makeContext({ forbiddenSlugs: new Set(['aria']) });

    expect(classifyCard(card, ctx)).toEqual({
      kind: 'refused',
      reason: 'not visible to the acting user',
    });
  });

  it('refuses when the row has no matching summary (owner unknown)', () => {
    const card = makeCard(FULL_CARD_DATA);
    const ctx = makeContext({ rowsBySlug: new Map([['aria', makeRow()]]) });

    expect(classifyCard(card, ctx)).toEqual({
      kind: 'refused',
      reason: 'owner unknown (not in list)',
    });
  });

  it('reports unchanged when the owned row already matches', () => {
    const card = makeCard(FULL_CARD_DATA);
    const ctx = makeContext({
      summaries: [makeSummary()],
      rowsBySlug: new Map([['aria', makeRow()]]),
    });

    expect(classifyCard(card, ctx)).toEqual({ kind: 'unchanged', targetSlug: 'aria', ignored: [] });
  });

  it('reports changed with the differing field names', () => {
    const card = makeCard({ ...FULL_CARD_DATA, personalityTone: 'cheerful' });
    const ctx = makeContext({
      summaries: [makeSummary()],
      rowsBySlug: new Map([['aria', makeRow({ personalityTone: 'grumpy' })]]),
    });

    expect(classifyCard(card, ctx)).toEqual({
      kind: 'changed',
      targetSlug: 'aria',
      fields: ['personalityTone'],
      ignored: [],
    });
  });

  describe('rename', () => {
    it('changed with targetSlug = old and slug in fields when the source exists', () => {
      const card = makeCard(FULL_CARD_DATA, 'aria-new');
      const ctx = makeContext({
        summaries: [makeSummary({ slug: 'aria-old' })],
        rowsBySlug: new Map([['aria-old', makeRow({ slug: 'aria-old' })]]),
        renameMap: new Map([['aria-old', 'aria-new']]),
      });

      const verdict = classifyCard(card, ctx);
      expect(verdict.kind).toBe('changed');
      if (verdict.kind === 'changed') {
        expect(verdict.targetSlug).toBe('aria-old');
        expect(verdict.fields).toContain('slug');
      }
    });

    it('CANARY: refuses a rename whose SOURCE 403s the same way', () => {
      const card = makeCard(FULL_CARD_DATA, 'aria-new');
      const ctx = makeContext({
        renameMap: new Map([['aria-old', 'aria-new']]),
        forbiddenSlugs: new Set(['aria-old']),
      });

      expect(classifyCard(card, ctx)).toEqual({
        kind: 'refused',
        reason: 'not visible to the acting user',
      });
    });

    it('refuses when the rename source is missing', () => {
      const card = makeCard(FULL_CARD_DATA, 'aria-new');
      const ctx = makeContext({ renameMap: new Map([['aria-old', 'aria-new']]) });

      expect(classifyCard(card, ctx)).toEqual({
        kind: 'refused',
        reason: 'rename source aria-old not found',
      });
    });

    it('refuses when the rename target already exists', () => {
      const card = makeCard(FULL_CARD_DATA, 'aria-new');
      const ctx = makeContext({
        rowsBySlug: new Map([
          ['aria-old', makeRow({ slug: 'aria-old' })],
          ['aria-new', makeRow({ slug: 'aria-new' })],
        ]),
        renameMap: new Map([['aria-old', 'aria-new']]),
      });

      expect(classifyCard(card, ctx)).toEqual({
        kind: 'refused',
        reason: 'rename target aria-new already exists',
      });
    });

    it('CANARY: refuses a rename whose TARGET 403s the acting user', () => {
      const card = makeCard(FULL_CARD_DATA, 'aria-new');
      const ctx = makeContext({
        rowsBySlug: new Map([['aria-old', makeRow({ slug: 'aria-old' })]]),
        renameMap: new Map([['aria-old', 'aria-new']]),
        forbiddenSlugs: new Set(['aria-new']),
      });

      expect(classifyCard(card, ctx)).toEqual({
        kind: 'refused',
        reason: 'rename target aria-new not visible to the acting user',
      });
    });

    it('a forbidden rename target is refused before the already-exists check', () => {
      const card = makeCard(FULL_CARD_DATA, 'aria-new');
      const ctx = makeContext({
        rowsBySlug: new Map([
          ['aria-old', makeRow({ slug: 'aria-old' })],
          ['aria-new', makeRow({ slug: 'aria-new' })],
        ]),
        renameMap: new Map([['aria-old', 'aria-new']]),
        forbiddenSlugs: new Set(['aria-new']),
      });

      expect(classifyCard(card, ctx)).toEqual({
        kind: 'refused',
        reason: 'rename target aria-new not visible to the acting user',
      });
    });

    it('CANARY: refuses a rename when the acting user is not the bot owner', () => {
      const card = makeCard(FULL_CARD_DATA, 'aria-new');
      const ctx = makeContext({
        summaries: [makeSummary({ slug: 'aria-old' })],
        rowsBySlug: new Map([['aria-old', makeRow({ slug: 'aria-old' })]]),
        renameMap: new Map([['aria-old', 'aria-new']]),
        isBotOwner: false,
      });

      expect(classifyCard(card, ctx)).toEqual({
        kind: 'refused',
        reason: 'slug changes need the bot owner',
      });
    });
  });
});

describe('classifyBatch', () => {
  it('CANARY: refuses the second of two new cards sharing a name in the same batch', () => {
    const cardOne = makeCard(FULL_CARD_DATA, 'aria-one', 'a-aria-one.json');
    const cardTwo = makeCard({ ...FULL_CARD_DATA, name: 'ARIA' }, 'aria-two', 'b-aria-two.json');
    const ctx = makeContext();

    const verdicts = classifyBatch([cardOne, cardTwo], ctx);

    expect(verdicts[0]).toEqual({ kind: 'new' });
    expect(verdicts[1]).toEqual({
      kind: 'refused',
      reason: 'duplicate of aria-one (same batch)',
    });
  });

  it('--create-new exempts the later card from the same-batch duplicate refusal', () => {
    const cardOne = makeCard(FULL_CARD_DATA, 'aria-one', 'a-aria-one.json');
    const cardTwo = makeCard({ ...FULL_CARD_DATA, name: 'ARIA' }, 'aria-two', 'b-aria-two.json');
    const ctx = makeContext({ createNew: new Set(['aria-two']) });

    const verdicts = classifyBatch([cardOne, cardTwo], ctx);

    expect(verdicts).toEqual([{ kind: 'new' }, { kind: 'new' }]);
  });

  it('does not refuse two new cards with distinct names', () => {
    const cardOne = makeCard(FULL_CARD_DATA, 'aria-one', 'a-aria-one.json');
    const cardTwo = makeCard({ ...FULL_CARD_DATA, name: 'Kestrel' }, 'kestrel', 'b-kestrel.json');
    const ctx = makeContext();

    expect(classifyBatch([cardOne, cardTwo], ctx)).toEqual([{ kind: 'new' }, { kind: 'new' }]);
  });

  it('CANARY: refuses the second of two cards targeting the same row (a direct card and a rename landing on it)', () => {
    const cardDirect = makeCard(FULL_CARD_DATA, 'aria', 'a-aria.json');
    const cardRename = makeCard(
      { ...FULL_CARD_DATA, personalityTone: 'cheerful' },
      'aria-new',
      'b-aria-new.json'
    );
    const ctx = makeContext({
      summaries: [makeSummary({ slug: 'aria' })],
      rowsBySlug: new Map([['aria', makeRow()]]),
      renameMap: new Map([['aria', 'aria-new']]),
    });

    const verdicts = classifyBatch([cardDirect, cardRename], ctx);

    expect(verdicts[0]).toEqual({ kind: 'unchanged', targetSlug: 'aria', ignored: [] });
    expect(verdicts[1]).toEqual({
      kind: 'refused',
      reason: 'same target as aria (same batch)',
    });
  });
});
