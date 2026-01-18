/**
 * GitHub API Tests
 *
 * Tests for the formatting helpers. API calls are not mocked since they
 * require gh CLI authentication.
 */

import { describe, it, expect } from 'vitest';
import { formatReviews, formatComments } from './github-api.js';

describe('formatReviews', () => {
  it('should return message for empty reviews', () => {
    const result = formatReviews([]);
    expect(result).toBe('No reviews found.');
  });

  it('should format reviews with user and state', () => {
    const reviews = [
      {
        id: 1,
        user: { login: 'reviewer1' },
        body: 'Looks good!',
        state: 'APPROVED',
        submitted_at: '2024-01-15T10:00:00Z',
      },
    ];
    const result = formatReviews(reviews);
    expect(result).toContain('reviewer1');
    expect(result).toContain('APPROVED');
    expect(result).toContain('Looks good!');
  });

  it('should handle reviews without body', () => {
    const reviews = [
      {
        id: 1,
        user: { login: 'reviewer1' },
        body: '',
        state: 'APPROVED',
        submitted_at: '2024-01-15T10:00:00Z',
      },
    ];
    const result = formatReviews(reviews);
    expect(result).toContain('(no comment)');
  });
});

describe('formatComments', () => {
  it('should return message for empty comments', () => {
    const result = formatComments([]);
    expect(result).toBe('No comments found.');
  });

  it('should format comments with user and body', () => {
    const comments = [
      {
        id: 1,
        user: { login: 'commenter1' },
        body: 'Nice work!',
        created_at: '2024-01-15T10:00:00Z',
      },
    ];
    const result = formatComments(comments);
    expect(result).toContain('commenter1');
    expect(result).toContain('Nice work!');
  });

  it('should include file path and line for line comments', () => {
    const comments = [
      {
        id: 1,
        user: { login: 'commenter1' },
        body: 'Fix this',
        created_at: '2024-01-15T10:00:00Z',
        path: 'src/foo.ts',
        line: 42,
      },
    ];
    const result = formatComments(comments);
    expect(result).toContain('src/foo.ts:42');
  });
});
