/**
 * Tests for Error Recovery Components
 */

import { describe, it, expect, vi } from 'vitest';
import { buildBackToBrowseRow } from './errorRecovery.js';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('buildBackToBrowseRow', () => {
  it('should return an action row with one button', () => {
    const row = buildBackToBrowseRow();
    expect(row.components).toHaveLength(1);
  });

  it('should use detail-back custom ID', () => {
    const row = buildBackToBrowseRow();
    const button = row.components[0] as unknown as { data: { custom_id: string } };
    expect(button.data.custom_id).toBe('shapes::detail-back');
  });

  it('should label the button "Back to Browse"', () => {
    const row = buildBackToBrowseRow();
    const button = row.components[0] as unknown as { data: { label: string } };
    expect(button.data.label).toBe('Back to Browse');
  });
});
