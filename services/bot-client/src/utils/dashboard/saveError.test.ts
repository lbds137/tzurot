/**
 * Tests for shared dashboard save-error handling.
 */

import { describe, it, expect } from 'vitest';
import {
  DashboardUpdateError,
  extractApiErrorMessage,
  isSaveTimeout,
  buildDashboardSaveErrorContent,
  SAVE_TIMEOUT_NOTICE,
} from './saveError.js';

describe('DashboardUpdateError', () => {
  it('carries the gateway status + kind and is an Error subclass', () => {
    const err = new DashboardUpdateError(
      'Failed to update preset: 0 - Request timeout',
      0,
      'timeout'
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DashboardUpdateError');
    expect(err.status).toBe(0);
    expect(err.kind).toBe('timeout');
    expect(err.message).toContain('Request timeout');
  });
});

describe('isSaveTimeout', () => {
  it('is true for an outcome-uncertain timeout abort', () => {
    expect(isSaveTimeout(new DashboardUpdateError('boom', 0, 'timeout'))).toBe(true);
  });

  it('is true for a network abort (outcome also uncertain)', () => {
    expect(isSaveTimeout(new DashboardUpdateError('boom', 0, 'network'))).toBe(true);
  });

  it('is FALSE for a schema failure despite status 0 — the write committed', () => {
    // A 'schema' failure means the gateway returned 200 OK but the response body
    // didn't parse; the write definitively committed, so "may still be applying"
    // would be a lie. This is the gap the kind discriminant closes.
    expect(isSaveTimeout(new DashboardUpdateError('boom', 0, 'schema'))).toBe(false);
  });

  it('is false for a DashboardUpdateError with a real HTTP status', () => {
    expect(isSaveTimeout(new DashboardUpdateError('boom: 400 - bad', 400, 'http'))).toBe(false);
  });

  it('is false for a plain Error or non-error value', () => {
    expect(isSaveTimeout(new Error('boom'))).toBe(false);
    expect(isSaveTimeout('string error')).toBe(false);
    expect(isSaveTimeout(null)).toBe(false);
  });
});

describe('extractApiErrorMessage', () => {
  it('extracts the API message from a structured error', () => {
    const error = new Error('Failed to update preset: 400 - Context window too large');
    expect(extractApiErrorMessage(error)).toBe('Context window too large');
  });

  it('returns null for non-Error values', () => {
    expect(extractApiErrorMessage('string error')).toBeNull();
    expect(extractApiErrorMessage(null)).toBeNull();
  });

  it('returns null for errors without the API format', () => {
    expect(extractApiErrorMessage(new Error('Network error'))).toBeNull();
  });

  it('returns null for non-API errors that merely contain dashes', () => {
    expect(extractApiErrorMessage(new Error('Request timed out - after 30s'))).toBeNull();
    expect(extractApiErrorMessage(new Error('TLS handshake failed - connection reset'))).toBeNull();
  });

  it('preserves dashes inside the API message portion', () => {
    const error = new Error('Failed to update preset: 400 - limit is 4096 - not 131072');
    expect(extractApiErrorMessage(error)).toBe('limit is 4096 - not 131072');
  });

  it('does not match a single-digit status (status-0 aborts fall through)', () => {
    expect(extractApiErrorMessage(new Error('Failed to update character: 0 - timeout'))).toBeNull();
  });

  it('truncates very long API messages', () => {
    const longMessage = 'A'.repeat(2000);
    const error = new Error(`Failed to update preset: 400 - ${longMessage}`);
    const result = extractApiErrorMessage(error);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(1801); // 1800 + ellipsis
    expect(result!.endsWith('…')).toBe(true);
  });
});

describe('buildDashboardSaveErrorContent', () => {
  it('shows the honest "may still be applying" notice on a timeout abort', () => {
    const error = new DashboardUpdateError(
      'Failed to update character: 0 - Request timeout',
      0,
      'timeout'
    );
    const content = buildDashboardSaveErrorContent(error, 'character');
    expect(content).toBe(SAVE_TIMEOUT_NOTICE);
    expect(content).toContain('may still be applying');
    expect(content).not.toContain('❌');
  });

  it('does NOT show the timeout notice on a schema failure (write committed)', () => {
    // status 0 but kind 'schema' → outcome is certain (the write committed; only
    // the read-back body failed to parse), so surface a failure message instead
    // of the misleading "may still be applying" notice.
    const error = new DashboardUpdateError(
      'Failed to update character: 0 - Response body is not valid JSON',
      0,
      'schema'
    );
    const content = buildDashboardSaveErrorContent(error, 'character');
    expect(content).not.toBe(SAVE_TIMEOUT_NOTICE);
    expect(content).toContain('❌');
  });

  it('surfaces the real gateway message on a genuine HTTP rejection', () => {
    const error = new DashboardUpdateError(
      'Failed to update character: 400 - avatarData: Invalid input: expected string, received null',
      400,
      'http'
    );
    expect(buildDashboardSaveErrorContent(error, 'character')).toBe(
      '❌ avatarData: Invalid input: expected string, received null'
    );
  });

  it('falls back to a per-resource generic failure for an unstructured error', () => {
    expect(buildDashboardSaveErrorContent(new Error('boom'), 'persona')).toBe(
      '❌ Failed to update persona. Please try again.'
    );
    expect(buildDashboardSaveErrorContent(new Error('boom'), 'preset')).toBe(
      '❌ Failed to update preset. Please try again.'
    );
  });
});
