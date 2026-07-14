import { describe, it, expect } from 'vitest';
import { NotifyLevelSchema } from '@tzurot/common-types/schemas/api/notifications';
import { LEVEL_LABELS, LEVEL_EXPLANATION } from './messages.js';

describe('notification level copy', () => {
  it('has a display label for every NotifyLevel value', () => {
    for (const level of NotifyLevelSchema.options) {
      expect(LEVEL_LABELS[level], `label for ${level}`).toBeDefined();
    }
  });

  it('explains all three weights', () => {
    expect(LEVEL_EXPLANATION).toContain('major');
    expect(LEVEL_EXPLANATION).toContain('minor');
    expect(LEVEL_EXPLANATION).toContain('patch');
  });
});
