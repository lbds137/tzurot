/**
 * Tests for inspect command interactive components
 */

import { describe, it, expect } from 'vitest';
import { buildInspectComponents } from './components.js';

describe('buildInspectComponents', () => {
  it('should return two action rows', () => {
    const rows = buildInspectComponents('test-req');
    expect(rows).toHaveLength(2);
  });

  it('should have buttons in first row', () => {
    const rows = buildInspectComponents('test-req');
    const buttonRow = rows[0];
    const components = buttonRow.components;
    expect(components).toHaveLength(2);
  });

  it('should have select menu in second row', () => {
    const rows = buildInspectComponents('test-req');
    const selectRow = rows[1];
    const components = selectRow.components;
    expect(components).toHaveLength(1);
  });

  it('should use inspect prefix in custom IDs', () => {
    const rows = buildInspectComponents('test-req');
    const buttonRow = rows[0];
    const button = buttonRow.components[0].toJSON();
    expect('custom_id' in button && button.custom_id).toContain('inspect::');
  });
});
