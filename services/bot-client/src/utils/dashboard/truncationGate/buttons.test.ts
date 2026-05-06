/**
 * Tests for the truncation-gate button row builders.
 *
 * Parameterized on `entityType` so the same builders produce the right
 * custom IDs for any dashboard. Tests verify both the character and
 * persona shape route correctly.
 */

import { describe, it, expect } from 'vitest';
import { ButtonStyle } from 'discord.js';
import { buildTruncationButtons, buildOpenEditorButtonRow } from './buttons.js';

describe('buildTruncationButtons', () => {
  it('emits three buttons with character entityType custom IDs', () => {
    const row = buildTruncationButtons('character', 'char-1', 'identity');
    const json = row.toJSON();
    expect(json.components).toHaveLength(3);
    const customIds = json.components.map(c => (c as { custom_id: string }).custom_id);
    // Ordered per `04-discord.md` Standard Button Order: Primary (View Full)
    // first, Secondary (Cancel) middle, Destructive (Edit with Truncation)
    // last. A regression that reverts to destructive-first would break
    // consistency with delete-confirmation dialogs across the codebase.
    expect(customIds).toEqual([
      'character::view_full::char-1::identity',
      'character::cancel_edit::char-1::identity',
      'character::edit_truncated::char-1::identity',
    ]);
  });

  it('emits three buttons with persona entityType custom IDs', () => {
    const row = buildTruncationButtons('persona', 'persona-uuid', 'identity');
    const json = row.toJSON();
    expect(json.components).toHaveLength(3);
    const customIds = json.components.map(c => (c as { custom_id: string }).custom_id);
    expect(customIds).toEqual([
      'persona::view_full::persona-uuid::identity',
      'persona::cancel_edit::persona-uuid::identity',
      'persona::edit_truncated::persona-uuid::identity',
    ]);
  });

  it('places the Danger-styled button last per destructive-last rule', () => {
    const row = buildTruncationButtons('character', 'char-1', 'identity');
    const json = row.toJSON();
    const styles = json.components.map(c => (c as { style: number }).style);
    // ButtonStyle.Danger = 4; verify it's the last button's style.
    expect(styles[styles.length - 1]).toBe(ButtonStyle.Danger);
  });

  it('sets an emoji on every button per 04-discord.md consistency rule', () => {
    // The rule (`.claude/rules/04-discord.md`) requires `.setEmoji()` on
    // every button for visual sizing consistency.
    const row = buildTruncationButtons('character', 'char-1', 'identity');
    const json = row.toJSON();
    for (const component of json.components) {
      const button = component as { emoji?: { name: string } };
      expect(button.emoji?.name, `button ${JSON.stringify(component)} missing emoji`).toBeDefined();
    }
  });
});

describe('buildOpenEditorButtonRow', () => {
  it('emits a single Open Editor button with character entityType custom ID', () => {
    const row = buildOpenEditorButtonRow('character', 'char-1', 'identity');
    const json = row.toJSON();
    expect(json.components).toHaveLength(1);
    const button = json.components[0] as { custom_id: string; label?: string };
    expect(button.custom_id).toBe('character::open_editor::char-1::identity');
    expect(button.label).toBe('Open Editor');
  });

  it('emits a single Open Editor button with persona entityType custom ID', () => {
    const row = buildOpenEditorButtonRow('persona', 'persona-uuid', 'identity');
    const json = row.toJSON();
    expect(json.components).toHaveLength(1);
    const button = json.components[0] as { custom_id: string; label?: string };
    expect(button.custom_id).toBe('persona::open_editor::persona-uuid::identity');
  });
});
