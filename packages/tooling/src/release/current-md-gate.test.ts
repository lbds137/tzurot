import { describe, it, expect } from 'vitest';
import {
  ALLOW_STALE_CURRENT_FLAG,
  checkCurrentMdReset,
  parseCurrentMdVersion,
} from './current-md-gate.js';

const ROOT = '/repo';

const currentMd = (version: string): string =>
  `# Current\n\n> **Version**: v${version} — a summary that changes every release\n\n---\n`;

/** A reader over an in-memory tree; a missing path throws, as `readFileSync` does. */
function reader(files: Record<string, string>): (path: string) => string {
  return (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  };
}

const tree = (
  currentMdText: string | undefined,
  packageJsonText: string
): Record<string, string> =>
  currentMdText === undefined
    ? { '/repo/package.json': packageJsonText }
    : { '/repo/CURRENT.md': currentMdText, '/repo/package.json': packageJsonText };

describe('parseCurrentMdVersion', () => {
  it('reads the version out of the header, ignoring the trailing summary', () => {
    expect(parseCurrentMdVersion(currentMd('3.0.0-beta.196'))).toBe('3.0.0-beta.196');
  });

  it('returns undefined when no header is present', () => {
    expect(parseCurrentMdVersion('# Current\n\nno header here\n')).toBeUndefined();
  });
});

describe('checkCurrentMdReset', () => {
  it('passes when CURRENT.md declares the version package.json is at', () => {
    const verdict = checkCurrentMdReset(ROOT, {
      readFile: reader(tree(currentMd('3.0.0-beta.196'), '{"version":"3.0.0-beta.196"}')),
    });
    expect(verdict.ok).toBe(true);
  });

  it('refuses on a mismatch, naming the skipped release step and the bypass', () => {
    const verdict = checkCurrentMdReset(ROOT, {
      readFile: reader(tree(currentMd('3.0.0-beta.195'), '{"version":"3.0.0-beta.196"}')),
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain('v3.0.0-beta.195');
    expect(verdict.reason).toContain('v3.0.0-beta.196');
    expect(verdict.reason).toContain('release step 9');
    expect(verdict.reason).toContain(ALLOW_STALE_CURRENT_FLAG);
  });

  it('refuses loudly on an unparseable header rather than reading it as a pass', () => {
    // Fail-closed: a header nobody can parse establishes nothing about whether
    // the reset happened, and a gate that passes on unreadable data is not one.
    const verdict = checkCurrentMdReset(ROOT, {
      readFile: reader(tree('# Current\n\nsomebody reformatted this\n', '{"version":"1.0.0"}')),
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain('no parseable');
  });

  it('refuses when CURRENT.md cannot be read at all', () => {
    const verdict = checkCurrentMdReset(ROOT, {
      readFile: reader(tree(undefined, '{"version":"1.0.0"}')),
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain('CURRENT.md could not be read');
  });

  it('refuses when package.json carries no string version', () => {
    const verdict = checkCurrentMdReset(ROOT, {
      readFile: reader(tree(currentMd('1.0.0'), '{"name":"root"}')),
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.reason).toContain('no string version field');
  });

  it('refuses when package.json is unparseable', () => {
    const verdict = checkCurrentMdReset(ROOT, {
      readFile: reader(tree(currentMd('1.0.0'), 'not json')),
    });

    expect(verdict.ok).toBe(false);
  });
});
