/**
 * Node-version pin drift guard.
 *
 * `.node-version` at the repo root names the ONE Node major every surface
 * must agree on: prod Docker images (`FROM node:<major>-slim`), the root
 * `engines.node` range, every workspace manifest's `@types/node` range, and
 * CI's `actions/setup-node` steps (which read the pin file directly via
 * `node-version-file`, rather than repeating the literal). An image major
 * that differs from the pin ships code on a runtime no gate exercised, and a
 * `@types/node` major ahead of the runtime admits APIs prod lacks. This guard
 * makes a future re-drift fail CI instead of surfacing as a silent runtime
 * gap, by deriving the requirement from `.node-version` and checking every
 * dependent surface against it. Clause (c) reads DIRECT `@types/node`
 * declarations only: a third-party package that lists `@types/node` as its
 * own dependency is not checked.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Reads `.node-version` and asserts its content is a bare trimmed integer major. */
function readNodeVersionMajor(root: string): number {
  const raw = readFileSync(path.join(root, '.node-version'), 'utf-8');
  const trimmed = raw.trim();
  expect(
    trimmed,
    `.node-version must contain a bare integer major (got ${JSON.stringify(raw)})`
  ).toMatch(/^\d+$/);
  return Number(trimmed);
}

interface DockerfileFromLine {
  file: string;
  line: number;
  text: string;
  tag: string;
}

/**
 * Finds every `FROM node:<tag>` line across each service's Dockerfile
 * (`services/<name>/Dockerfile`), allowing an optional `--platform=...` flag
 * before the image reference.
 */
function findServiceDockerfileFromLines(root: string): DockerfileFromLine[] {
  const servicesDir = path.join(root, 'services');
  const found: DockerfileFromLine[] = [];
  let entries: string[];
  try {
    entries = readdirSync(servicesDir);
  } catch {
    return found;
  }

  const fromPattern = /^\s*FROM\s+(?:--platform=\S+\s+)?node:(\S+)/;
  for (const entry of entries) {
    const dockerfilePath = path.join(servicesDir, entry, 'Dockerfile');
    if (!existsSync(dockerfilePath)) {
      continue;
    }
    const lines = readFileSync(dockerfilePath, 'utf-8').split('\n');
    lines.forEach((text, index) => {
      const match = fromPattern.exec(text);
      if (match) {
        found.push({
          file: `services/${entry}/Dockerfile`,
          line: index + 1,
          text,
          tag: match[1],
        });
      }
    });
  }
  return found;
}

interface TypesNodeDeclaration {
  file: string;
  range: string;
}

/**
 * Enumerates every workspace manifest that declares `@types/node` (in either
 * `dependencies` or `devDependencies`): root `package.json`, plus
 * `packages/*`, `services/*`, `scripts/package.json`, `tests/package.json`.
 */
function findTypesNodeDeclarations(root: string): TypesNodeDeclaration[] {
  const manifestPaths: string[] = ['package.json'];

  for (const group of ['packages', 'services']) {
    const groupDir = path.join(root, group);
    let entries: string[];
    try {
      entries = readdirSync(groupDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const rel = `${group}/${entry}/package.json`;
      if (existsSync(path.join(root, rel))) {
        manifestPaths.push(rel);
      }
    }
  }

  for (const rel of ['scripts/package.json', 'tests/package.json']) {
    if (existsSync(path.join(root, rel))) {
      manifestPaths.push(rel);
    }
  }

  const declarations: TypesNodeDeclaration[] = [];
  for (const rel of manifestPaths) {
    const parsed = JSON.parse(readFileSync(path.join(root, rel), 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const range = parsed.dependencies?.['@types/node'] ?? parsed.devDependencies?.['@types/node'];
    if (range !== undefined) {
      declarations.push({ file: rel, range });
    }
  }
  return declarations;
}

/** Extracts the leading integer major from a semver-range-ish string like `^24.13.6`. */
function leadingMajor(range: string): number | undefined {
  const match = /(\d+)/.exec(range);
  return match ? Number(match[1]) : undefined;
}

describe('node-version-pin', () => {
  const major = readNodeVersionMajor(repoRoot);

  it('(a) every services/*/Dockerfile FROM node:<tag> line matches the pinned major', () => {
    const fromLines = findServiceDockerfileFromLines(repoRoot);
    expect(
      fromLines.length,
      'expected at least 10 `FROM node:<tag>` lines under services/*/Dockerfile — ' +
        'found none, which means the scan itself is broken, not that the fleet shrank'
    ).toBeGreaterThanOrEqual(10);

    const offenders = fromLines.filter(({ tag }) => leadingMajor(tag) !== major);
    expect(
      offenders.map(({ file, line, tag }) => `${file}:${line} FROM node:${tag}`),
      `every service Dockerfile FROM line must pin node major ${major} (from .node-version) — ` +
        'change the pin file and every dependent surface together'
    ).toEqual([]);
  });

  it('(b) root package.json engines.node matches the pinned major range exactly', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8')) as {
      engines?: { node?: string };
    };
    const expected = `>=${major}.0.0 <${major + 1}.0.0`;
    expect(
      pkg.engines?.node,
      `package.json engines.node must read exactly "${expected}" (derived from .node-version) — ` +
        'change the pin file and every dependent surface together'
    ).toBe(expected);
  });

  it('(c) every workspace manifest declaring @types/node uses a range on the pinned major', () => {
    const declarations = findTypesNodeDeclarations(repoRoot);
    expect(
      declarations.length,
      'expected at least 17 manifests declaring @types/node — found none, which means the ' +
        'scan itself is broken, not that the dependency disappeared'
    ).toBeGreaterThanOrEqual(17);

    const offenders = declarations.filter(({ range }) => leadingMajor(range) !== major);
    expect(
      offenders.map(({ file, range }) => `${file}: "${range}"`),
      `every manifest's @types/node range must lead with major ${major} (from .node-version) — ` +
        'change the pin file and every dependent surface together'
    ).toEqual([]);
  });

  it('(d) no workflow hardcodes node-version; at least one reads .node-version via node-version-file', () => {
    const workflowsDir = path.join(repoRoot, '.github', 'workflows');
    const files = readdirSync(workflowsDir).filter(f => f.endsWith('.yml'));
    const hardcodedPattern = /^\s*node-version:\s/;
    const fileVersionPattern = /^\s*node-version-file:\s*'\.node-version'/;

    const offenders: string[] = [];
    let sawFileVersion = false;

    for (const file of files) {
      const lines = readFileSync(path.join(workflowsDir, file), 'utf-8').split('\n');
      lines.forEach((text, index) => {
        if (hardcodedPattern.test(text)) {
          offenders.push(`.github/workflows/${file}:${index + 1} "${text.trim()}"`);
        }
        if (fileVersionPattern.test(text)) {
          sawFileVersion = true;
        }
      });
    }

    expect(
      offenders,
      'a hardcoded `node-version:` step drifts from .node-version silently — ' +
        "replace it with `node-version-file: '.node-version'` (change the pin file and every " +
        'dependent surface together)'
    ).toEqual([]);
    expect(
      sawFileVersion,
      "expected at least one `node-version-file: '.node-version'` step — found none, which " +
        'means the positive control itself is broken'
    ).toBe(true);
  });
});
