/**
 * Tests for the export-smoke validator's manifest/directory checks.
 */

import { describe, it, expect } from 'vitest';
import { strToU8 } from 'fflate';
import { ACCOUNT_EXPORT_FIXED_PATHS } from '@tzurot/common-types/schemas/export/accountExportManifest';
import { validateManifest } from './exportSmokeManifestChecks.js';
import type { ExportSmokeExpectedCounts } from './exportSmokeValidator.js';

const EMPTY_EXPECTED: ExportSmokeExpectedCounts = {
  personas: [],
  characters: [],
  conversationCountsByPersonalityId: {},
  memoryCountsByPersonalityId: {},
  factCountsByPersonalityId: {},
  totals: { personas: 0, characters: 0, conversations: 0, memories: 0, facts: 0 },
  isSuperuser: false,
};

function baselineFiles(): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const path of ACCOUNT_EXPORT_FIXED_PATHS) {
    files[path] = strToU8('placeholder');
  }
  // Overwrite with a schema-valid empty directory — every other fixed path's
  // content is irrelevant to these tests (validateManifest never parses it).
  files['personality-directory.json'] = strToU8('[]');
  return files;
}

describe('exportSmokeManifestChecks validateManifest', () => {
  it('reports no findings for a complete manifest with an empty, valid directory', () => {
    const findings: string[] = [];
    const result = validateManifest(baselineFiles(), EMPTY_EXPECTED, findings);
    expect(findings).toEqual([]);
    expect(result.directory).toEqual([]);
  });

  it('reports a finding and returns a null directory when personality-directory.json is missing', () => {
    const files = baselineFiles();
    delete files['personality-directory.json'];
    const findings: string[] = [];
    const result = validateManifest(files, EMPTY_EXPECTED, findings);
    expect(result.directory).toBeNull();
    expect(findings).toContain('manifest: personality-directory.json is missing');
  });

  it('reports a finding and returns a null directory when personality-directory.json fails to parse', () => {
    const files = baselineFiles();
    files['personality-directory.json'] = strToU8('not json');
    const findings: string[] = [];
    const result = validateManifest(files, EMPTY_EXPECTED, findings);
    expect(result.directory).toBeNull();
    expect(findings).toContain('manifest: personality-directory.json failed to parse');
  });

  it('reports a finding and returns a null directory when personality-directory.json fails schema validation', () => {
    const files = baselineFiles();
    files['personality-directory.json'] = strToU8(JSON.stringify({ not: 'an array' }));
    const findings: string[] = [];
    const result = validateManifest(files, EMPTY_EXPECTED, findings);
    expect(result.directory).toBeNull();
    expect(findings).toContain('manifest: personality-directory.json failed schema validation');
  });

  it('CANARY: reports a finding when a required fixed path is missing from the archive', () => {
    const files = baselineFiles();
    delete files['profile.json'];
    const findings: string[] = [];
    validateManifest(files, EMPTY_EXPECTED, findings);
    expect(findings).toContain('manifest: required path missing — profile.json');
  });

  it('reports a finding when an unexpected file is present in the archive', () => {
    const files = baselineFiles();
    files['unexpected/rogue.json'] = strToU8('{}');
    const findings: string[] = [];
    validateManifest(files, EMPTY_EXPECTED, findings);
    expect(findings).toContain('manifest: unexpected file in archive — unexpected/rogue.json');
  });

  it('flags a foldered-section file for a personality with a zero expected count', () => {
    // The round-2 blind spot: prefix-based recognition accepted any file
    // under conversations/ etc., so an assembler emitting a file the source
    // snapshot never predicted passed silently. Directory entry present,
    // count map empty — the file must be unexpected.
    const files = baselineFiles();
    files['personality-directory.json'] = strToU8(
      JSON.stringify([{ id: '4f9b0f66-0000-4000-8000-00000000f003', name: 'Ghost', slug: 'ghost' }])
    );
    files['conversations/ghost.json'] = strToU8('[]');
    const findings: string[] = [];
    validateManifest(files, EMPTY_EXPECTED, findings);
    expect(findings).toContain('manifest: unexpected file in archive — conversations/ghost.json');
  });

  it('flags a persona file not present in the source snapshot, and its md sibling', () => {
    const files = baselineFiles();
    files['personas/rogue-12345678.json'] = strToU8('{}');
    files['personas/rogue-12345678.md'] = strToU8('rogue');
    const findings: string[] = [];
    validateManifest(files, EMPTY_EXPECTED, findings);
    expect(findings).toContain(
      'manifest: unexpected file in archive — personas/rogue-12345678.json'
    );
    expect(findings).toContain('manifest: unexpected file in archive — personas/rogue-12345678.md');
  });

  it('does not flag foldered-section files the snapshot expects', () => {
    const files = baselineFiles();
    files['personality-directory.json'] = strToU8(
      JSON.stringify([{ id: '4f9b0f66-0000-4000-8000-00000000f003', name: 'Ghost', slug: 'ghost' }])
    );
    files['conversations/ghost.json'] = strToU8('[]');
    files['conversations/ghost.md'] = strToU8('log');
    const findings: string[] = [];
    validateManifest(
      files,
      {
        ...EMPTY_EXPECTED,
        conversationCountsByPersonalityId: { '4f9b0f66-0000-4000-8000-00000000f003': 2 },
      },
      findings
    );
    expect(findings).toEqual([]);
  });

  it('reports a finding when the superuser-only admin-settings path is present for a non-superuser export', () => {
    const files = baselineFiles();
    files['account/admin-settings.json'] = strToU8('{}');
    const findings: string[] = [];
    validateManifest(files, EMPTY_EXPECTED, findings);
    expect(findings).toContain('manifest: forbidden path present — account/admin-settings.json');
  });

  it('does not flag account/admin-settings.json as forbidden for a superuser export', () => {
    const files = baselineFiles();
    files['account/admin-settings.json'] = strToU8('{}');
    const findings: string[] = [];
    validateManifest(files, { ...EMPTY_EXPECTED, isSuperuser: true }, findings);
    expect(findings).not.toContain(
      'manifest: forbidden path present — account/admin-settings.json'
    );
  });
});
