/**
 * Tests for the export-smoke validator's id-consistency + row-count checks.
 */

import { describe, it, expect } from 'vitest';
import { strToU8 } from 'fflate';
import { validateIdsAndCounts } from './exportSmokeCountChecks.js';
import type { ExportSmokeExpectedCounts } from './exportSmokeValidator.js';
import type { PersonalityDirectoryEntries } from './exportSmokeManifestChecks.js';

const PERSONALITY_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const OTHER_PERSONALITY_ID = 'cccccccc-0000-0000-0000-000000000001';
const PERSONA_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

const DIRECTORY: PersonalityDirectoryEntries = [
  { id: PERSONALITY_ID, name: 'Char One', slug: 'char-one' },
];

const EXPECTED: ExportSmokeExpectedCounts = {
  personas: [{ id: PERSONA_ID, name: 'Persona One' }],
  characters: [{ id: PERSONALITY_ID, slug: 'char-one' }],
  conversationCountsByPersonalityId: { [PERSONALITY_ID]: 2 },
  memoryCountsByPersonalityId: { [PERSONALITY_ID]: 1 },
  factCountsByPersonalityId: {},
  totals: { personas: 1, characters: 1, conversations: 2, memories: 1, facts: 0 },
  isSuperuser: false,
};

function baselineFiles(): Record<string, Uint8Array> {
  return {
    'personas/Persona_One-bbbbbbbb.json': strToU8(
      JSON.stringify({ id: PERSONA_ID, name: 'Persona One' })
    ),
    'characters/char-one.json': strToU8(JSON.stringify({ slug: 'char-one' })),
    'conversations/char-one.json': strToU8(
      JSON.stringify([{ personalityId: PERSONALITY_ID }, { personalityId: PERSONALITY_ID }])
    ),
    'memories/char-one.json': strToU8(JSON.stringify([{ personalityId: PERSONALITY_ID }])),
  };
}

describe('exportSmokeCountChecks validateIdsAndCounts', () => {
  it('reports no findings for a fully consistent baseline', () => {
    const findings: string[] = [];
    validateIdsAndCounts(baselineFiles(), DIRECTORY, EXPECTED, findings);
    expect(findings).toEqual([]);
  });

  it('reports a finding when a count-map personalityId is not in the directory', () => {
    const expected: ExportSmokeExpectedCounts = {
      ...EXPECTED,
      conversationCountsByPersonalityId: { [OTHER_PERSONALITY_ID]: 1 },
    };
    const files = baselineFiles();
    files['conversations/unknown-abcd1234.json'] = strToU8(
      JSON.stringify([{ personalityId: OTHER_PERSONALITY_ID }])
    );
    const findings: string[] = [];
    validateIdsAndCounts(files, DIRECTORY, expected, findings);
    expect(
      findings.some(f =>
        f.includes(`personalityId ${OTHER_PERSONALITY_ID} from the count snapshot`)
      )
    ).toBe(true);
  });

  it('reports a finding when a conversations row personalityId maps to a different stem', () => {
    const files = baselineFiles();
    files['conversations/wrong-stem.json'] = files['conversations/char-one.json']!;
    delete files['conversations/char-one.json'];
    const findings: string[] = [];
    validateIdsAndCounts(files, DIRECTORY, EXPECTED, findings);
    expect(
      findings.some(
        f =>
          f ===
          'id: conversations/wrong-stem.json contains a row whose personalityId maps to a different stem'
      )
    ).toBe(true);
  });

  it('reports a finding when a character row slug does not sanitize to its own filename stem', () => {
    const files = baselineFiles();
    files['characters/char-one.json'] = strToU8(JSON.stringify({ slug: 'different-slug' }));
    const findings: string[] = [];
    validateIdsAndCounts(files, DIRECTORY, EXPECTED, findings);
    expect(findings).toContain(
      'id: characters/char-one.json slug does not sanitize to its own filename stem'
    );
  });

  it('reports a finding when a persona filename stem does not match its own row id/name', () => {
    const files = baselineFiles();
    files['personas/Persona_One-bbbbbbbb.json'] = strToU8(
      JSON.stringify({ id: PERSONA_ID, name: 'Different Name' })
    );
    const findings: string[] = [];
    validateIdsAndCounts(files, DIRECTORY, EXPECTED, findings);
    expect(findings).toContain(
      "id: personas/Persona_One-bbbbbbbb.json filename stem does not match its own row's id/name"
    );
  });

  it('CANARY: reports a finding when totals.personas is off by one from the actual persona file count', () => {
    const expected: ExportSmokeExpectedCounts = {
      ...EXPECTED,
      totals: { ...EXPECTED.totals, personas: 2 },
    };
    const findings: string[] = [];
    validateIdsAndCounts(baselineFiles(), DIRECTORY, expected, findings);
    expect(findings).toContain('counts: personas/*.json file count expected 2 got 1');
  });

  it('reports a finding when a foldered section row count does not match the expected sum', () => {
    const expected: ExportSmokeExpectedCounts = {
      ...EXPECTED,
      conversationCountsByPersonalityId: { [PERSONALITY_ID]: 3 },
    };
    const findings: string[] = [];
    validateIdsAndCounts(baselineFiles(), DIRECTORY, expected, findings);
    expect(findings).toContain('counts: conversations/char-one.json expected 3 rows, got 2');
  });

  it('sums counts across two personalityIds sharing the same sanitized stem', () => {
    const collidingDirectory: PersonalityDirectoryEntries = [
      { id: PERSONALITY_ID, name: 'Char One', slug: 'char-one' },
      { id: OTHER_PERSONALITY_ID, name: 'Char One Dup', slug: 'char-one' },
    ];
    const expected: ExportSmokeExpectedCounts = {
      ...EXPECTED,
      conversationCountsByPersonalityId: { [PERSONALITY_ID]: 2, [OTHER_PERSONALITY_ID]: 1 },
    };
    const files = baselineFiles();
    files['conversations/char-one.json'] = strToU8(
      JSON.stringify([
        { personalityId: PERSONALITY_ID },
        { personalityId: PERSONALITY_ID },
        { personalityId: OTHER_PERSONALITY_ID },
      ])
    );
    const findings: string[] = [];
    validateIdsAndCounts(files, collidingDirectory, expected, findings);
    expect(findings).toEqual([]);
  });
});
