import { describe, it, expect } from 'vitest';
import { GitHubReleaseSchema, newestPublishedRelease, type GitHubRelease } from './release.js';

function makeRelease(overrides: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    id: 1,
    tag_name: 'v3.0.0-beta.166',
    name: null,
    body: null,
    draft: false,
    prerelease: false,
    html_url: 'https://github.com/lbds137/tzurot/releases/tag/v3.0.0-beta.166',
    published_at: '2026-07-15T04:00:00Z',
    ...overrides,
  };
}

describe('GitHubReleaseSchema', () => {
  it('accepts a real-shaped release payload and strips extras', () => {
    const parsed = GitHubReleaseSchema.parse({ ...makeRelease(), assets: [], author: {} });
    expect(parsed).not.toHaveProperty('assets');
    expect(parsed.tag_name).toBe('v3.0.0-beta.166');
  });

  it('accepts a draft with null published_at', () => {
    const parsed = GitHubReleaseSchema.parse(makeRelease({ published_at: null }));
    expect(parsed.published_at).toBeNull();
  });

  it('rejects a missing required field', () => {
    const { tag_name: _tagName, ...withoutTagName } = makeRelease();
    expect(() => GitHubReleaseSchema.parse(withoutTagName)).toThrow();
  });

  it('rejects a non-boolean prerelease flag', () => {
    expect(() => GitHubReleaseSchema.parse({ ...makeRelease(), prerelease: 'true' })).toThrow();
  });
});

describe('newestPublishedRelease', () => {
  it('picks by published_at, not array order', () => {
    const older = makeRelease({ id: 1, tag_name: 'v-older', published_at: '2026-07-01T00:00:00Z' });
    const newer = makeRelease({ id: 2, tag_name: 'v-newer', published_at: '2026-07-15T00:00:00Z' });
    // Oldest listed first — an array-order-picking implementation would
    // return `older` here, which this assertion catches.
    expect(newestPublishedRelease([older, newer])).toEqual(newer);
  });

  it('excludes drafts (null published_at) even when otherwise newest', () => {
    const draft = makeRelease({ id: 1, tag_name: 'v-draft', published_at: null });
    const published = makeRelease({
      id: 2,
      tag_name: 'v-published',
      published_at: '2026-07-01T00:00:00Z',
    });
    expect(newestPublishedRelease([draft, published])).toEqual(published);
  });

  it('returns null for an empty list', () => {
    expect(newestPublishedRelease([])).toBeNull();
  });

  it('returns null when every release is a draft', () => {
    const draft = makeRelease({ published_at: null });
    expect(newestPublishedRelease([draft])).toBeNull();
  });
});
