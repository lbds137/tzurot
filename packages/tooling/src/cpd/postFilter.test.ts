import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyLine, classifyFragment, filterReport, loadJscpdReport } from './postFilter.js';

describe('classifyLine', () => {
  it.each([
    ['await ensureNoNameCollision(res, service, {', 'call'],
    ['service.update(configId, body);', 'call'],
    ['logger.info({ configId }, "msg");', 'call'],
    ['!(await someHelper(args))', 'call'],
    ['(await asyncFn()).result', 'call'],
  ] as const)('classifies %s as %s', (line, expected) => {
    expect(classifyLine(line)).toBe(expected);
  });

  it.each([
    ['if (config === null) {', 'structural'],
    ['  if (body.name !== undefined && config.isGlobal) {', 'structural'],
    ['return sendError(res, ErrorResponses.notFound());', 'structural'],
    ['const config = await service.getById(id);', 'structural'],
    ['let updated;', 'structural'],
    ['for (const item of items) {', 'structural'],
    ['throw new Error("foo");', 'structural'],
    ['try {', 'structural'],
    ['} catch (err) {', 'structural'],
  ] as const)('classifies %s as %s', (line, expected) => {
    expect(classifyLine(line)).toBe(expected);
  });

  it.each([
    ['', 'noise'],
    ['  ', 'noise'],
    ['}', 'noise'],
    ['});', 'noise'],
    ['),', 'noise'],
    ['  })', 'noise'],
    ['    },', 'noise'],
    ['    select: { id: true },', 'noise'],
    ['    where: { id: configId },', 'noise'],
  ] as const)('classifies %s as %s (noise/continuation)', (line, expected) => {
    expect(classifyLine(line)).toBe(expected);
  });

  it('classifies `if (await call())` as structural — control flow wins over call shape', () => {
    expect(classifyLine('if (await checkSomething()) {')).toBe('structural');
  });

  it.each([
    [`import { createLogger } from '@tzurot/common-types/utils/logger';`, 'import'],
    [
      `import type { DeferredCommandContext } from '../../utils/commandContext/types.js';`,
      'import',
    ],
    [`import { type EnvConfig } from '@tzurot/common-types/config/config';`, 'import'],
    [`import chalk from 'chalk';`, 'import'],
    [`import './browse.js';`, 'import'],
    [`import {`, 'import'],
    [`export { renderSpec } from '../../ux/render/render.js';`, 'import'],
    [`export * from './modeLabels.js';`, 'import'],
    [`export type { SettingsDashboardConfig } from './types.js';`, 'import'],
    [`  import { CATALOG } from '../../ux/catalog/catalog.js';`, 'import'],
  ] as const)('classifies %s as %s (module boundary)', (line, expected) => {
    expect(classifyLine(line)).toBe(expected);
  });

  it.each([
    [`export const DEFAULT_LIMIT = 10;`, 'noise'],
    [`export function buildPayload(opts: Opts) {`, 'noise'],
    [`export type SettingsView = 'full' | 'compact';`, 'noise'],
    [`export default createHandler();`, 'noise'],
  ] as const)(
    'does NOT classify declaration export %s as import (falls through as before)',
    (line, expected) => {
      expect(classifyLine(line)).toBe(expected);
    }
  );
});

describe('classifyFragment', () => {
  it('flags a pure helper-call-shape fragment as call-dominant', () => {
    const fragment = `
      await ensureNoNameCollision(res, service, {
        name: body.name,
        scope: { type: 'USER' },
        formatCollisionMessage: n => \`Conflict: \${n}\`,
      })
    `;
    const result = classifyFragment(fragment);
    expect(result.isCallDominant).toBe(true);
    expect(result.callRatio).toBeGreaterThan(0.5);
  });

  it('flags a fragment with significant business logic as NOT call-dominant', () => {
    const fragment = `
      if (existing === null) {
        return sendError(res, ErrorResponses.notFound());
      }
      if (!existing.isGlobal) {
        return sendError(res, ErrorResponses.validationError('not global'));
      }
      const updated = await service.update(id, body);
    `;
    const result = classifyFragment(fragment);
    expect(result.isCallDominant).toBe(false);
  });

  it('handles fragments that are pure noise (closing braces) without dividing by zero', () => {
    const fragment = `
      })
      )
      }
    `;
    const result = classifyFragment(fragment);
    expect(result.callRatio).toBe(0);
    expect(result.isCallDominant).toBe(false);
  });

  it('respects custom threshold', () => {
    // 2 calls, 1 structural — ratio = 2/3 ≈ 0.667
    const fragment = `
      await firstCall();
      await secondCall();
      if (cond) return;
    `;
    expect(classifyFragment(fragment, 0.8).isCallDominant).toBe(false);
    expect(classifyFragment(fragment, 0.6).isCallDominant).toBe(true);
  });

  it('flags an import-dominated fragment as import-dominant (not real duplication)', () => {
    // Mirrors the persona/default.ts ↔ voice/replies.ts clone: a shared import
    // block plus one trailing const line.
    const fragment = `
      import { CATALOG } from '../../ux/catalog/catalog.js';
      import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
      import { renderSpec } from '../../ux/render/render.js';
      import {
        AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
        isAutocompleteErrorSentinel,
      } from '../../utils/apiCheck.js';
      import { clientsFor } from '../../utils/gatewayClients.js';
      import { createLogger } from '@tzurot/common-types/utils/logger';
      import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
      const logger = createLogger('module-name');
    `;
    const result = classifyFragment(fragment);
    expect(result.importLines).toBe(7);
    expect(result.importRatio).toBeGreaterThanOrEqual(0.8);
    expect(result.isImportDominant).toBe(true);
    expect(result.isCallDominant).toBe(false);
  });

  it('keeps a mixed fragment with real call lines counted (not import-dominant)', () => {
    const fragment = `
      import { renderSpec } from '../../ux/render/render.js';
      import { clientsFor } from '../../utils/gatewayClients.js';
      await clientsFor(guildId).personas.update(id, body);
      renderSpec(embed, layout);
      await persistSelection(res, opts);
    `;
    const result = classifyFragment(fragment);
    expect(result.isImportDominant).toBe(false);
    expect(result.isCallDominant).toBe(true);
  });

  it('handles an all-noise fragment for the import ratio without dividing by zero', () => {
    const fragment = `
      })
      }
    `;
    const result = classifyFragment(fragment);
    expect(result.importRatio).toBe(0);
    expect(result.isImportDominant).toBe(false);
  });
});

describe('filterReport', () => {
  const baseReport = (duplicates: Array<{ fragment: string; lines: number }>) => ({
    statistics: {
      total: {
        clones: duplicates.length,
        duplicatedLines: duplicates.reduce((s, d) => s + d.lines, 0),
        lines: 1000,
        percentage: 1.0,
      },
    },
    duplicates: duplicates.map((d, i) => ({
      format: 'typescript',
      lines: d.lines,
      fragment: d.fragment,
      tokens: 0,
      firstFile: {
        name: `/abs/path/file-${i}-a.ts`,
        start: 1,
        end: d.lines,
        startLoc: {} as never,
        endLoc: {} as never,
      },
      secondFile: {
        name: `/abs/path/file-${i}-b.ts`,
        start: 1,
        end: d.lines,
        startLoc: {} as never,
        endLoc: {} as never,
      },
    })),
  });

  it('excludes call-dominant clones from the filtered count', () => {
    const result = filterReport(
      baseReport([
        // Call-dominant — should be excluded
        {
          fragment: `await fooHelper(res, opts);\nawait barHelper(opts);`,
          lines: 10,
        },
        // Logic — should be kept
        {
          fragment: `if (x === null) return;\nthrow new Error('bad');`,
          lines: 15,
        },
      ])
    );

    expect(result.rawCount).toBe(2);
    expect(result.filteredCount).toBe(1);
    expect(result.excludedCount).toBe(1);
    expect(result.filteredLines).toBe(15);
  });

  it('excludes import-dominant clones from the filtered count', () => {
    const result = filterReport(
      baseReport([
        // Import-dominant (shared import block + one const) — excluded
        {
          fragment: `import { clientsFor } from '../../utils/gatewayClients.js';\nimport { CATALOG } from '../../ux/catalog/catalog.js';\nimport { renderSpec } from '../../ux/render/render.js';\nimport { classifyGatewayFailure } from '../../ux/catalog/classify.js';\nconst logger = createLogger('x');`,
          lines: 13,
        },
        // Logic — kept
        {
          fragment: `if (x === null) return;\nthrow new Error('bad');`,
          lines: 15,
        },
      ])
    );

    expect(result.filteredCount).toBe(1);
    expect(result.excludedCount).toBe(1);
    expect(result.filteredLines).toBe(15);
  });

  it('aggregates remaining clones by file pair', () => {
    const result = filterReport(baseReport([{ fragment: `if (x) throw new Error();`, lines: 5 }]));

    expect(result.remainingByPair).toHaveLength(1);
    expect(result.remainingByPair[0].clones).toBe(1);
    expect(result.remainingByPair[0].lines).toBe(5);
  });

  it('returns zero filtered count when all clones are call-dominant', () => {
    const result = filterReport(
      baseReport([
        { fragment: `await foo();\nawait bar();`, lines: 3 },
        { fragment: `service.update(x);\nlogger.info(y);`, lines: 3 },
      ])
    );

    expect(result.filteredCount).toBe(0);
    expect(result.excludedCount).toBe(2);
    expect(result.filteredLines).toBe(0);
  });
});

describe('loadJscpdReport', () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir !== undefined) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  // resolve(cwd, absolutePath) returns absolutePath unchanged, so loadJscpdReport
  // works correctly when given an absolute path without needing to chdir (which
  // vitest workers don't support).
  const writeReport = (filename: string, content: string): string => {
    tmpDir = mkdtempSync(join(tmpdir(), 'jscpd-load-test-'));
    const absPath = join(tmpDir, filename);
    writeFileSync(absPath, content);
    return absPath;
  };

  it('parses a well-formed report', () => {
    const path = writeReport(
      'report.json',
      JSON.stringify({
        statistics: { total: { clones: 5, duplicatedLines: 100, lines: 1000, percentage: 10 } },
        duplicates: [],
      })
    );

    const result = loadJscpdReport(path);
    expect(result.statistics.total.clones).toBe(5);
    expect(result.duplicates).toEqual([]);
  });

  it('throws on invalid JSON', () => {
    const path = writeReport('garbage.json', 'not-json-at-all');
    expect(() => loadJscpdReport(path)).toThrow(/not valid JSON/);
  });

  it('throws when duplicates field is missing', () => {
    const path = writeReport(
      'no-dups.json',
      JSON.stringify({ statistics: { total: { clones: 0, duplicatedLines: 0 } } })
    );
    expect(() => loadJscpdReport(path)).toThrow(/missing or invalid 'duplicates' array/);
  });

  it('throws when statistics.total.clones is missing', () => {
    const path = writeReport(
      'no-clones.json',
      JSON.stringify({ statistics: { total: {} }, duplicates: [] })
    );
    expect(() => loadJscpdReport(path)).toThrow(/missing 'statistics\.total\.clones'/);
  });
});
