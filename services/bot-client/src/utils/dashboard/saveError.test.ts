/**
 * Tests for shared dashboard save-error handling (adapter over ux/catalog's
 * classifier — the honest-outcome semantics are pinned HERE at the dashboard
 * seam; the classifier's own truth table lives in ux/catalog/classify.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { GatewayApiError } from '@tzurot/clients';
import { buildDashboardSaveErrorContent } from './saveError.js';

describe('buildDashboardSaveErrorContent', () => {
  it('shows the honest "may still be applying" notice on a timeout abort', () => {
    const error = new GatewayApiError(
      'Failed to update character: 0 - Request timeout',
      0,
      'timeout'
    );
    const content = buildDashboardSaveErrorContent(error, 'character');
    expect(content).toContain('may still be applying');
    expect(content).toContain('🔄 Refresh'); // dashboards HAVE the refresh control
    expect(content).not.toMatch(/try again/i); // uncertain outcome never invites a retry
    expect(content).not.toContain('❌');
  });

  it('shows the "saved, refresh to verify" notice on a schema failure (write committed)', () => {
    // status 0 but kind 'schema' → outcome is certain (the write committed; only
    // the read-back body failed to parse). Not "may still be applying" (uncertain)
    // and not "try again" (risks a duplicate write) — the write definitively saved.
    const error = new GatewayApiError(
      'Failed to update character: 0 - Response body is not valid JSON',
      0,
      'schema'
    );
    const content = buildDashboardSaveErrorContent(error, 'character');
    expect(content).toContain('was saved');
    expect(content).toContain('🔄 Refresh');
    expect(content).not.toContain('may still be applying');
    expect(content).not.toMatch(/try again/i);
    expect(content).not.toContain('❌'); // not a failure framing — the write committed
  });

  it('is outcome-uncertain for a network abort too', () => {
    const error = new GatewayApiError('Failed to update preset: 0 - fetch failed', 0, 'network');
    expect(buildDashboardSaveErrorContent(error, 'preset')).toContain('may still be applying');
  });

  it('surfaces the real gateway message on a genuine HTTP rejection', () => {
    const error = new GatewayApiError(
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
