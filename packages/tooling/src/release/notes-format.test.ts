import { describe, it, expect } from 'vitest';
import {
  parseConventional,
  formatLineItem,
  groupBySections,
  renderMarkdown,
  type MergedPr,
} from './notes-format.js';

describe('parseConventional', () => {
  it('parses a typical feat with scope', () => {
    expect(parseConventional('feat(ai-worker): migrate cookie scheme')).toEqual({
      type: 'feat',
      scope: 'ai-worker',
      breaking: false,
      description: 'migrate cookie scheme',
    });
  });

  it('parses a typical fix without scope', () => {
    expect(parseConventional('fix: handle null ref')).toEqual({
      type: 'fix',
      scope: null,
      breaking: false,
      description: 'handle null ref',
    });
  });

  it('parses a breaking change with `!` suffix', () => {
    expect(parseConventional('feat(api)!: rename endpoint')).toEqual({
      type: 'feat',
      scope: 'api',
      breaking: true,
      description: 'rename endpoint',
    });
  });

  it('parses a breaking change without scope', () => {
    expect(parseConventional('refactor!: collapse shell-path helper')).toEqual({
      type: 'refactor',
      scope: null,
      breaking: true,
      description: 'collapse shell-path helper',
    });
  });

  it('trims trailing whitespace from the description', () => {
    expect(parseConventional('chore: clean up   ')?.description).toBe('clean up');
  });

  it('returns null for titles that are not Conventional Commits', () => {
    expect(parseConventional('Fix the thing')).toBeNull();
    expect(parseConventional('WIP: pending work')).toBeNull();
    expect(parseConventional('')).toBeNull();
  });

  it('returns null for unknown Conventional-Commit types', () => {
    // "hotfix" is not in the commitlint allowlist — must not parse.
    expect(parseConventional('hotfix: urgent')).toBeNull();
  });
});

describe('formatLineItem', () => {
  const pr: MergedPr = { number: 123, title: '', mergedAt: '2026-04-22T12:00:00Z' };

  it('renders `- **scope:** description (#N)` for a scoped PR', () => {
    expect(
      formatLineItem(pr, {
        type: 'feat',
        scope: 'ai-worker',
        breaking: false,
        description: 'add thing',
      })
    ).toBe('- **ai-worker:** add thing (#123)');
  });

  it('falls back to `misc` when the PR has no scope', () => {
    expect(
      formatLineItem(pr, {
        type: 'chore',
        scope: null,
        breaking: false,
        description: 'sweep',
      })
    ).toBe('- **misc:** sweep (#123)');
  });
});

describe('groupBySections', () => {
  function pr(number: number, title: string): MergedPr {
    return { number, title, mergedAt: '2026-04-22T00:00:00Z' };
  }

  it('groups PRs by their mapped section', () => {
    const { sections } = groupBySections([
      pr(1, 'feat(a): add'),
      pr(2, 'fix(b): fix'),
      pr(3, 'refactor(c): cleanup'),
      pr(4, 'perf(d): speed'),
      pr(5, 'chore(e): sweep'),
    ]);
    expect(sections.get('Features')).toEqual(['- **a:** add (#1)']);
    expect(sections.get('Bug Fixes')).toEqual(['- **b:** fix (#2)']);
    // `refactor` and `perf` both bucket into Improvements.
    expect(sections.get('Improvements')).toEqual(['- **c:** cleanup (#3)', '- **d:** speed (#4)']);
    expect(sections.get('Chores')).toEqual(['- **e:** sweep (#5)']);
  });

  it('routes breaking changes to Breaking Changes regardless of type', () => {
    const { sections } = groupBySections([
      pr(1, 'feat(a)!: breaking feature'),
      pr(2, 'fix(b)!: breaking fix'),
      pr(3, 'feat(c): normal feature'),
    ]);
    expect(sections.get('Breaking Changes')).toEqual([
      '- **a:** breaking feature (#1)',
      '- **b:** breaking fix (#2)',
    ]);
    expect(sections.get('Features')).toEqual(['- **c:** normal feature (#3)']);
  });

  it('collects unparseable PR titles separately', () => {
    const { sections, unparseable } = groupBySections([
      pr(1, 'feat(a): add'),
      pr(2, 'WIP: something'),
      pr(3, 'Merge branch foo'),
    ]);
    expect(sections.size).toBe(1);
    expect(unparseable.map(p => p.number)).toEqual([2, 3]);
  });

  it('routes test: to Tests and docs:/ci:/build: to Chores', () => {
    const { sections } = groupBySections([
      pr(1, 'test(coverage): add unit tests'),
      pr(2, 'docs(readme): update'),
      pr(3, 'ci(actions): fix workflow'),
      pr(4, 'build(deps): bump library'),
    ]);
    expect(sections.get('Tests')).toEqual(['- **coverage:** add unit tests (#1)']);
    expect(sections.get('Chores')).toEqual([
      '- **readme:** update (#2)',
      '- **actions:** fix workflow (#3)',
      '- **deps:** bump library (#4)',
    ]);
  });

  it('preserves input order within each section', () => {
    const { sections } = groupBySections([
      pr(1, 'feat(a): first'),
      pr(2, 'feat(b): second'),
      pr(3, 'feat(c): third'),
    ]);
    expect(sections.get('Features')).toEqual([
      '- **a:** first (#1)',
      '- **b:** second (#2)',
      '- **c:** third (#3)',
    ]);
  });
});

describe('renderMarkdown', () => {
  function pr(number: number, title: string): MergedPr {
    return { number, title, mergedAt: '2026-04-22T00:00:00Z' };
  }

  const OPTIONS = {
    fromTag: 'v3.0.0-beta.103',
    fromTimestamp: '2026-04-22T10:00:00Z',
  };

  it('renders a complete markdown document with banner, sections, and compare URL', () => {
    const grouped = groupBySections([pr(1, 'feat(ai): X'), pr(2, 'fix(bot): Y')]);
    const md = renderMarkdown(grouped, OPTIONS);

    expect(md).toContain('<!-- Draft release notes from merged PRs since v3.0.0-beta.103');
    expect(md).toContain('WARNING: review each line');
    expect(md).toContain('### Features');
    expect(md).toContain('- **ai:** X (#1)');
    expect(md).toContain('### Bug Fixes');
    expect(md).toContain('- **bot:** Y (#2)');
    expect(md).toContain(
      '**Full Changelog**: https://github.com/lbds137/tzurot/compare/v3.0.0-beta.103...HEAD'
    );
  });

  it('emits Breaking Changes as the first section when present', () => {
    const grouped = groupBySections([pr(1, 'feat(a): normal'), pr(2, 'feat(b)!: breaking')]);
    const md = renderMarkdown(grouped, OPTIONS);

    // Breaking Changes heading must appear before Features heading.
    const breakingIdx = md.indexOf('### Breaking Changes');
    const featuresIdx = md.indexOf('### Features');
    expect(breakingIdx).toBeGreaterThanOrEqual(0);
    expect(featuresIdx).toBeGreaterThan(breakingIdx);
  });

  it('omits empty sections entirely', () => {
    const grouped = groupBySections([pr(1, 'feat(a): only a feature')]);
    const md = renderMarkdown(grouped, OPTIONS);
    expect(md).toContain('### Features');
    expect(md).not.toContain('### Bug Fixes');
    expect(md).not.toContain('### Breaking Changes');
  });

  it('emits an Unparseable section when present', () => {
    const grouped = groupBySections([pr(1, 'feat(a): normal'), pr(2, 'WIP: unparseable')]);
    const md = renderMarkdown(grouped, OPTIONS);
    expect(md).toContain('### Unparseable');
    expect(md).toContain('- WIP: unparseable (#2)');
  });

  it('renders the warning banner even when there is only one PR', () => {
    const grouped = groupBySections([pr(1, 'chore: minor')]);
    const md = renderMarkdown(grouped, OPTIONS);
    expect(md).toContain('WARNING');
  });
});
