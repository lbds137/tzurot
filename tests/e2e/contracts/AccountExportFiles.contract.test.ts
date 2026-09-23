/**
 * Contract test: account-export ZIP files (ai-worker producer → bot-client consumer).
 *
 * Reads the COMMITTED fixtures written by the producer half
 * (`services/ai-worker/src/jobs/AccountExportFilesContract.producer.test.ts`,
 * which runs the REAL `buildAccountExportFiles`) and validates every `.json`
 * entry against the manifest's file-schema table
 * (`resolveExportSchemaForPath`) — the same lookup the bot-client
 * export-path smoke (`exportSmokeSchemaChecks.ts`) uses.
 *
 * Non-circular by construction: the payload is REAL producer output, so a
 * drift in `buildAccountExportFiles` that breaks a manifest schema (a new
 * key, a missing key, a nullability change) fails HERE instead of the
 * weekly export-path smoke.
 */

import { describe, it, expect } from 'vitest';
import { loadContractFixture } from '@tzurot/test-utils';
import {
  ACCOUNT_EXPORT_FIXED_PATHS,
  resolveExportSchemaForPath,
} from '@tzurot/common-types/schemas/export/accountExportManifest';

interface FixturePayload {
  paths: string[];
  json: Record<string, unknown>;
}

/** Mirrors the smoke validator's `issueSummary` so a red finding here reads
 *  exactly like the smoke's own finding. */
function issueSummary(error: { issues: { path: PropertyKey[]; code: string }[] }): string {
  return error.issues
    .map(issue => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}:${issue.code}`)
    .join('; ');
}

describe.each(['full.json', 'sparse.json'])(
  'Contract: account-export ZIP files (real producer fixture → manifest schemas, %s)',
  fixtureName => {
    const fixture = loadContractFixture<FixturePayload>(`account-export/${fixtureName}`);

    it('carries every fixed path the manifest declares', () => {
      for (const path of ACCOUNT_EXPORT_FIXED_PATHS) {
        expect(fixture.paths).toContain(path);
      }
    });

    it('gates the superuser-only admin-settings path on the fixture name', () => {
      if (fixtureName === 'full.json') {
        expect(fixture.paths).toContain('account/admin-settings.json');
      } else {
        expect(fixture.paths).not.toContain('account/admin-settings.json');
      }
    });

    it("validates every .json entry against the manifest's file-schema table (the smoke's own gate)", () => {
      const jsonPaths = fixture.paths.filter(path => path.endsWith('.json'));
      const failures: string[] = [];

      for (const path of jsonPaths) {
        const schema = resolveExportSchemaForPath(path);
        if (schema === undefined) {
          failures.push(`json-schema: ${path} is an unrecognized json path`);
          continue;
        }
        const result = schema.safeParse(fixture.json[path]);
        if (!result.success) {
          failures.push(`json-schema: ${path} failed validation (${issueSummary(result.error)})`);
        }
      }

      expect(failures).toEqual([]);
    });

    if (fixtureName === 'full.json') {
      it('carries at least one persona with digests and one without, including a null-stamped digest', () => {
        const personaPaths = fixture.paths.filter(
          path => path.startsWith('personas/') && path.endsWith('.json')
        );
        expect(personaPaths.length).toBeGreaterThan(0);

        const personas = personaPaths.map(path => fixture.json[path] as { digests: unknown[] });
        expect(personas.some(persona => persona.digests.length > 0)).toBe(true);
        expect(personas.some(persona => persona.digests.length === 0)).toBe(true);

        const allDigests = personas.flatMap(
          persona => persona.digests as { generatedAt: string | null }[]
        );
        expect(allDigests.some(digest => digest.generatedAt === null)).toBe(true);
      });
    }
  }
);
