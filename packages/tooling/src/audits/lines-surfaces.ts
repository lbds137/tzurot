/**
 * What the always-loaded context surfaces ARE, and how they are measured.
 *
 * Split from `lines-check.ts` so the definitions (which surfaces exist, which
 * dimensions they are measured on, and the arithmetic behind each) sit apart
 * from the ratchet that compares them to a baseline. They grow on different
 * schedules: adding a surface or a dimension touches only this module, while
 * changing how a budget is evaluated or reported touches only the other.
 *
 * Everything here is pure measurement — no baseline, no thresholds, no
 * verdicts. That boundary is what lets the ratchet's tests state budgets as
 * plain fixtures rather than building a filesystem.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { UsageError } from '../utils/errors.js';

/**
 * Bump whenever the measurement-affecting logic changes (count arithmetic,
 * surface globs, surface set, the dimension set) — invalidates baselines and
 * forces an explicit `lines:update-baseline` refresh.
 *
 * 2: added the bytes dimension.
 */
export const LINES_IMPL_VERSION = 2;

/**
 * The tracked dimensions, in report order. Part of the config fingerprint, so
 * adding one invalidates every baseline rather than silently going ungated on
 * the new axis.
 */
export const DIMENSION_NAMES = ['lines', 'bytes'] as const;
export type DimensionName = (typeof DIMENSION_NAMES)[number];

/** The tracked surfaces, in stable order (part of the config fingerprint). */
export const SURFACE_NAMES = ['rules', 'current'] as const;
export type SurfaceName = (typeof SURFACE_NAMES)[number];

/**
 * What each surface measures. Two glob shapes are supported — a literal
 * file path, or a single-directory `<dir>/*.md` — because that's all the
 * always-loaded surfaces need. Not a general glob engine, on purpose.
 */
export const SURFACE_GLOBS: Record<SurfaceName, string> = {
  rules: '.claude/rules/*.md',
  current: 'CURRENT.md',
};

/**
 * Default grace margins (lines) for newly-tracked surfaces. Sized to absorb
 * legitimate small additions between baseline refreshes: ~150 lines across
 * the ten rules files is one modest new section; ~20 lines keeps CURRENT.md
 * near its session-status cap.
 */
export const DEFAULT_GRACE_MARGINS: Record<SurfaceName, number> = {
  rules: 150,
  current: 20,
};

/**
 * Default grace margins (bytes). Set from the same intent as the line margins
 * rather than by converting them, because the two surfaces absorb different
 * things: ~7% on rules is one modest new section at the corpus's own average
 * density, and ~11% on CURRENT.md is a release's smoke checklist, which is
 * legitimate mid-release growth that reverts at the next reset.
 */
export const DEFAULT_BYTES_GRACE_MARGINS: Record<SurfaceName, number> = {
  rules: 12_000,
  current: 4_000,
};

/** The measurement-affecting config slice — the baseline drift contract. */
export function getLinesConfigFingerprint(): Record<string, unknown> {
  return {
    implVersion: LINES_IMPL_VERSION,
    surfaces: [...SURFACE_NAMES],
    dimensions: [...DIMENSION_NAMES],
    globs: {
      rules: SURFACE_GLOBS.rules,
      current: SURFACE_GLOBS.current,
    },
  };
}

/**
 * Throws unless `name` is a tracked surface. A `UsageError` rather than a bare
 * one: a typo'd `--surface` is the operator's to fix by retyping, and a stack
 * trace would tell them nothing about it.
 */
export function assertSurfaceName(name: string): SurfaceName {
  if (!(SURFACE_NAMES as readonly string[]).includes(name)) {
    throw new UsageError(
      `Unknown surface "${name}". Tracked surfaces: ${SURFACE_NAMES.join(', ')}.`
    );
  }
  return name as SurfaceName;
}

/**
 * The surface names to evaluate: the CANONICAL set, plus any extra key the
 * baseline happens to carry.
 *
 * Iterating the baseline alone would skip a canonical surface that has no
 * baseline entry — no failure, no bullet, nothing in any report, while the
 * surface goes completely ungated. Both the ratchet and the health aggregator
 * need exactly this list, which is why it lives here rather than in either of
 * them: two copies of a set rule is two places for it to drift.
 */
export function trackedSurfaceNames(baselineSurfaces: Record<string, unknown>): string[] {
  return [
    ...SURFACE_NAMES,
    ...Object.keys(baselineSurfaces).filter(
      name => !(SURFACE_NAMES as readonly string[]).includes(name)
    ),
  ];
}

export interface FileMeasurement {
  /** Path as the surface's glob produced it, relative to the repo root. */
  path: string;
  lines: number;
  bytes: number;
}

export interface SurfaceMeasurement {
  /** Sum of line counts across every file the surface's glob matched. */
  lines: number;
  /** Sum of UTF-8 byte counts across the same files. */
  bytes: number;
  /**
   * How many files matched. Zero is the hollow-measurement signal: the
   * surface "measures" 0 lines only because nothing was found — a moved
   * directory or renamed file must fail loudly, never pass at 0.
   */
  fileCount: number;
}

export type MeasuredSurfaces = Record<SurfaceName, SurfaceMeasurement>;

/**
 * `wc -l`-compatible line count: number of newline-terminated lines, with a
 * final unterminated line still counting as one. Empty file = 0.
 */
export function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  const segments = content.split('\n');
  return segments[segments.length - 1] === '' ? segments.length - 1 : segments.length;
}

/** Expand one of the two supported glob shapes into absolute file paths. */
function matchSurfaceFiles(rootDir: string, glob: string): string[] {
  const dirGlobSuffix = '/*.md';
  if (glob.endsWith(dirGlobSuffix)) {
    const dir = join(rootDir, glob.slice(0, -dirGlobSuffix.length));
    try {
      return readdirSync(dir)
        .filter(name => name.endsWith('.md'))
        .sort()
        .map(name => join(dir, name));
    } catch {
      // Missing directory = zero matches; the evaluator turns that into a
      // hollow-measurement failure rather than a silent 0-line pass.
      return [];
    }
  }
  const file = join(rootDir, glob);
  return existsSync(file) ? [file] : [];
}

/**
 * Measure one surface FILE BY FILE, in glob order.
 *
 * The aggregate below is a sum of exactly this, so the two can never disagree
 * about what a surface weighs — which matters because the per-file view is
 * what a trim is planned from, and a ranking that disagreed with the gate
 * would send the reader at a file the gate does not actually count.
 *
 * Bytes are the file's actual on-disk size, which is what it costs to load —
 * `content.length` would count a multi-byte character once and under-report
 * exactly the em-dashes and check-marks these documents are full of.
 */
export function measureSurfaceFiles(rootDir: string, surface: SurfaceName): FileMeasurement[] {
  return matchSurfaceFiles(rootDir, SURFACE_GLOBS[surface]).map(file => {
    // Read ONCE as a Buffer: `buf.length` is the file's actual on-disk size.
    // Decoding to a string first and re-encoding would substitute U+FFFD for
    // any invalid sequence and then count the REPLACEMENT's bytes, which
    // would quietly make the "exact" claim above false exactly where it
    // matters most — on a file that is not what it looks like.
    const buf = readFileSync(file);
    return {
      path: relative(rootDir, file),
      lines: countLines(buf.toString('utf-8')),
      bytes: buf.length,
    };
  });
}

/** Measure every tracked surface under `rootDir`, aggregated. */
export function measureSurfaces(rootDir: string): MeasuredSurfaces {
  const measured = {} as MeasuredSurfaces;
  for (const name of SURFACE_NAMES) {
    const files = measureSurfaceFiles(rootDir, name);
    measured[name] = {
      lines: files.reduce((sum, file) => sum + file.lines, 0),
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      fileCount: files.length,
    };
  }
  return measured;
}
