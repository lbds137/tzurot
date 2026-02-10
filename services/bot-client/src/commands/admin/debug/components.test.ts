import { describe, it, expect } from 'vitest';
import { buildDebugComponents } from './components.js';
import { DebugCustomIds } from './customIds.js';
import { DebugViewType } from './types.js';

describe('buildDebugComponents', () => {
  const requestId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  it('should return two action rows', () => {
    const rows = buildDebugComponents(requestId);
    expect(rows).toHaveLength(2);
  });

  it('should have buttons in the first row', () => {
    const rows = buildDebugComponents(requestId);
    const buttonRow = rows[0].toJSON();
    expect(buttonRow.components).toHaveLength(2);

    // First button: View Reasoning (Primary)
    expect(buttonRow.components[0]).toMatchObject({
      custom_id: DebugCustomIds.button(requestId, DebugViewType.Reasoning),
      label: 'View Reasoning',
      style: 1, // ButtonStyle.Primary
    });

    // Second button: Full JSON (Secondary)
    expect(buttonRow.components[1]).toMatchObject({
      custom_id: DebugCustomIds.button(requestId, DebugViewType.FullJson),
      label: 'Full JSON',
      style: 2, // ButtonStyle.Secondary
    });
  });

  it('should have a select menu in the second row', () => {
    const rows = buildDebugComponents(requestId);
    const selectRow = rows[1].toJSON();
    expect(selectRow.components).toHaveLength(1);

    const menu = selectRow.components[0] as { custom_id?: string; type: number };
    expect(menu.custom_id).toBe(DebugCustomIds.selectMenu(requestId));
    expect(menu.type).toBe(3); // ComponentType.StringSelect
  });

  it('should have four select menu options', () => {
    const rows = buildDebugComponents(requestId);
    const selectRow = rows[1].toJSON();
    const menu = selectRow.components[0] as { options?: { value: string }[] };
    expect(menu.options).toHaveLength(4);

    const values = menu.options!.map(o => o.value);
    expect(values).toContain(DebugViewType.CompactJson);
    expect(values).toContain(DebugViewType.SystemPrompt);
    expect(values).toContain(DebugViewType.MemoryInspector);
    expect(values).toContain(DebugViewType.TokenBudget);
  });
});
