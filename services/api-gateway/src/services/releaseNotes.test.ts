import { describe, it, expect } from 'vitest';
import { BROADCAST_MESSAGE_MAX_LENGTH } from '@tzurot/common-types/schemas/api/broadcast';
import {
  parseReleaseSections,
  classifyReleaseLevel,
  formatReleaseAnnouncement,
} from './releaseNotes.js';

const REALISTIC_BODY = [
  '### Features',
  '',
  '- **bot-client:** release announcement DMs (#1651)',
  '- **api-gateway:** github release webhook (#1651)',
  '',
  '### Bug Fixes',
  '',
  '- **ai-worker:** dedup hole in STM/LTM boundary (#1645)',
  '',
  '**Full Changelog**: https://github.com/lbds137/tzurot/compare/v3.0.0-beta.165...v3.0.0-beta.166',
].join('\n');

describe('parseReleaseSections', () => {
  it('splits H3 sections in document order and captures the trailer', () => {
    const parsed = parseReleaseSections(REALISTIC_BODY);
    expect(parsed.sections.map(s => s.heading)).toEqual(['Features', 'Bug Fixes']);
    expect(parsed.trailer).toMatch(/^\*\*Full Changelog\*\*/);
    expect(parsed.preamble.join('')).toBe('');
  });

  it('keeps lines before the first heading as preamble', () => {
    const parsed = parseReleaseSections('An intro line.\n\n### Features\n- item');
    expect(parsed.preamble[0]).toBe('An intro line.');
    expect(parsed.sections[0].lines).toEqual(['- item']);
  });

  it('does not treat deeper headings (####) as sections', () => {
    const parsed = parseReleaseSections('### Features\n#### details\n- item');
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].lines).toEqual(['#### details', '- item']);
  });
});

describe('classifyReleaseLevel', () => {
  it.each([
    ['### Breaking Changes\n- drop v2 API\n### Features\n- shiny', 'major'],
    ['### Features\n- shiny thing', 'minor'],
    ['### Bug Fixes\n- fixed it\n### Chores\n- swept', 'patch'],
    ['### Database Migrations\n- add table', 'patch'],
    ['', 'patch'],
    ['Just some prose with no sections.', 'patch'],
  ])('classifies %j as %s', (body, expected) => {
    expect(classifyReleaseLevel(parseReleaseSections(body))).toBe(expected);
  });

  it('ignores an empty section heading — no items, no claim', () => {
    const body = '### Breaking Changes\n\n### Bug Fixes\n- real fix';
    expect(classifyReleaseLevel(parseReleaseSections(body))).toBe('patch');
  });

  it('matches level sections case-insensitively (hand-edit resilience)', () => {
    expect(classifyReleaseLevel(parseReleaseSections('### breaking changes\n- x'))).toBe('major');
  });
});

describe('formatReleaseAnnouncement', () => {
  const META = {
    tagName: 'v3.0.0-beta.166',
    htmlUrl: 'https://github.com/lbds137/tzurot/releases/tag/v3.0.0-beta.166',
  };

  it('renders title, sections in document order minus trailer, then the link', () => {
    const message = formatReleaseAnnouncement(META, parseReleaseSections(REALISTIC_BODY));
    expect(message.startsWith('**v3.0.0-beta.166**\n\n')).toBe(true);
    expect(message.endsWith(`\n\n${META.htmlUrl}`)).toBe(true);
    expect(message).not.toContain('Full Changelog');
    expect(message.indexOf('### Features')).toBeLessThan(message.indexOf('### Bug Fixes'));
    // Markdown intact — no escaping of the owner-authored content.
    expect(message).toContain('- **bot-client:** release announcement DMs (#1651)');
  });

  it('falls back to title + link when the body is empty', () => {
    const message = formatReleaseAnnouncement(META, parseReleaseSections(''));
    expect(message).toBe(`**${META.tagName}**\n\n${META.htmlUrl}`);
  });

  it('trims whole trailing lines to fit the cap, keeping the link intact', () => {
    const longBody = `### Features\n${Array.from({ length: 200 }, (_, i) => `- item number ${i} with some descriptive padding text`).join('\n')}`;
    const message = formatReleaseAnnouncement(META, parseReleaseSections(longBody));
    expect(message.length).toBeLessThanOrEqual(BROADCAST_MESSAGE_MAX_LENGTH);
    expect(message.endsWith(`\n\n${META.htmlUrl}`)).toBe(true);
    expect(message).toContain('…');
    // Cut at a line boundary: the last content line before the marker is whole.
    const contentPart = message.slice(0, message.lastIndexOf('\n\n'));
    expect(contentPart.endsWith('…')).toBe(true);
  });

  it('hard-cuts a single pathological line that overflows the whole budget', () => {
    const oneLine = `### Features\n- ${'x'.repeat(3000)}`;
    const message = formatReleaseAnnouncement(META, parseReleaseSections(oneLine));
    expect(message.length).toBeLessThanOrEqual(BROADCAST_MESSAGE_MAX_LENGTH);
    expect(message.endsWith(`\n\n${META.htmlUrl}`)).toBe(true);
  });
});
