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

  it('omits byte hint on View Reasoning button when thinking length is 0 / not passed', () => {
    const rows = buildInspectComponents('test-req');
    const reasoningButton = rows[0].components[0].toJSON();
    expect('label' in reasoningButton && reasoningButton.label).toBe('View Reasoning');
  });

  it('shows raw count when thinking content is under 1k chars', () => {
    const rows = buildInspectComponents('test-req', 250);
    const reasoningButton = rows[0].components[0].toJSON();
    expect('label' in reasoningButton && reasoningButton.label).toBe('View Reasoning (250)');
  });

  it('shows X.Xk format for 1k-99k char range', () => {
    const rows = buildInspectComponents('test-req', 1063);
    const reasoningButton = rows[0].components[0].toJSON();
    expect('label' in reasoningButton && reasoningButton.label).toBe('View Reasoning (1.1k)');
  });

  it('shows integer Xk format for 100k+ chars', () => {
    const rows = buildInspectComponents('test-req', 145_300);
    const reasoningButton = rows[0].components[0].toJSON();
    expect('label' in reasoningButton && reasoningButton.label).toBe('View Reasoning (145k)');
  });

  it('uses the more-descriptive select-menu placeholder', () => {
    const rows = buildInspectComponents('test-req');
    const selectMenu = rows[1].components[0].toJSON();
    expect('placeholder' in selectMenu && selectMenu.placeholder).toBe('More diagnostic views…');
  });

  it('exposes the expected number of select-menu options', () => {
    const rows = buildInspectComponents('test-req');
    const selectMenu = rows[1].components[0].toJSON();
    // Compact JSON, System Prompt, Memory Inspector, Token Budget, Pipeline Health, Quick Copy
    expect('options' in selectMenu && selectMenu.options).toHaveLength(6);
  });
});
