/**
 * Tests for buildBrowseSelectMenu factory.
 *
 * Covers:
 * - Happy path: items → numbered options with truncation
 * - Empty input → returns null (legitimate empty state)
 * - >25 items → throws (caller bug)
 * - Duplicate values → throws (caller bug)
 * - Numbering uses startIndex offset (page 2 of 10-per-page → 21..30)
 * - Long labels are truncated AFTER numbering prefix is added
 * - Newlines in labels and descriptions are always stripped
 * - Optional description field is omitted when undefined
 */

import { describe, it, expect } from 'vitest';
import { ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';

import { buildBrowseSelectMenu, type BrowseSelectOption } from './selectMenuBuilder.js';
import { MAX_SELECT_LABEL_LENGTH } from './constants.js';

interface TestItem {
  id: string;
  name: string;
  description?: string;
}

const sampleItem = (id: string, name: string, description?: string): TestItem => ({
  id,
  name,
  ...(description !== undefined ? { description } : {}),
});

const formatTestItem = (item: TestItem): BrowseSelectOption => ({
  label: item.name,
  value: item.id,
  description: item.description,
});

describe('buildBrowseSelectMenu', () => {
  describe('happy path', () => {
    it('returns an ActionRowBuilder containing a select menu with numbered options', () => {
      const row = buildBrowseSelectMenu<TestItem>({
        items: [sampleItem('a', 'Alpha'), sampleItem('b', 'Beta'), sampleItem('c', 'Gamma')],
        customId: 'test::select',
        placeholder: 'Pick one...',
        startIndex: 0,
        formatItem: formatTestItem,
      });

      expect(row).toBeInstanceOf(ActionRowBuilder);
      const selectMenu = row?.components[0] as StringSelectMenuBuilder;
      expect(selectMenu).toBeInstanceOf(StringSelectMenuBuilder);

      const json = selectMenu.toJSON();
      expect(json.custom_id).toBe('test::select');
      expect(json.placeholder).toBe('Pick one...');
      expect(json.min_values).toBe(1);
      expect(json.max_values).toBe(1);
      expect(json.options).toHaveLength(3);
      expect(json.options[0]).toMatchObject({ label: '1. Alpha', value: 'a' });
      expect(json.options[1]).toMatchObject({ label: '2. Beta', value: 'b' });
      expect(json.options[2]).toMatchObject({ label: '3. Gamma', value: 'c' });
    });

    it('passes the 1-based display number to formatItem', () => {
      const seenNumbers: number[] = [];
      buildBrowseSelectMenu<TestItem>({
        items: [sampleItem('a', 'Alpha'), sampleItem('b', 'Beta')],
        customId: 'test::select',
        placeholder: 'Pick one...',
        startIndex: 0,
        formatItem: (item, num) => {
          seenNumbers.push(num);
          return { label: item.name, value: item.id };
        },
      });

      expect(seenNumbers).toEqual([1, 2]);
    });

    it('honors startIndex for cross-page numbering', () => {
      // Page 2 of a 10-per-page list → items numbered 21–22
      const row = buildBrowseSelectMenu<TestItem>({
        items: [sampleItem('a', 'Alpha'), sampleItem('b', 'Beta')],
        customId: 'test::select::page2',
        placeholder: 'Pick one...',
        startIndex: 20,
        formatItem: formatTestItem,
      });

      const options = (row?.components[0] as StringSelectMenuBuilder).toJSON().options;
      expect(options[0]).toMatchObject({ label: '21. Alpha' });
      expect(options[1]).toMatchObject({ label: '22. Beta' });
    });

    it('includes description when formatItem returns one', () => {
      const row = buildBrowseSelectMenu<TestItem>({
        items: [sampleItem('a', 'Alpha', 'first letter')],
        customId: 'test::select',
        placeholder: 'Pick one...',
        startIndex: 0,
        formatItem: formatTestItem,
      });

      const option = (row?.components[0] as StringSelectMenuBuilder).toJSON().options[0];
      expect(option.description).toBe('first letter');
    });

    it('omits description when formatItem returns undefined', () => {
      const row = buildBrowseSelectMenu<TestItem>({
        items: [sampleItem('a', 'Alpha')],
        customId: 'test::select',
        placeholder: 'Pick one...',
        startIndex: 0,
        formatItem: formatTestItem,
      });

      const option = (row?.components[0] as StringSelectMenuBuilder).toJSON().options[0];
      expect(option.description).toBeUndefined();
    });
  });

  describe('empty state', () => {
    it('returns null when items is empty', () => {
      const row = buildBrowseSelectMenu<TestItem>({
        items: [],
        customId: 'test::select',
        placeholder: 'Pick one...',
        startIndex: 0,
        formatItem: formatTestItem,
      });

      expect(row).toBeNull();
    });
  });

  describe('caller-bug guards (throw, do not silently drop)', () => {
    it('throws when items.length exceeds 25 (Discord hard limit)', () => {
      const items = Array.from({ length: 26 }, (_, i) =>
        sampleItem(`id-${i.toString()}`, `Item ${i.toString()}`)
      );

      expect(() =>
        buildBrowseSelectMenu<TestItem>({
          items,
          customId: 'test::select',
          placeholder: 'Pick one...',
          startIndex: 0,
          formatItem: formatTestItem,
        })
      ).toThrow(/exceeds Discord's limit of 25/);
    });

    it('accepts exactly 25 items (boundary case)', () => {
      const items = Array.from({ length: 25 }, (_, i) =>
        sampleItem(`id-${i.toString()}`, `Item ${i.toString()}`)
      );

      const row = buildBrowseSelectMenu<TestItem>({
        items,
        customId: 'test::select',
        placeholder: 'Pick one...',
        startIndex: 0,
        formatItem: formatTestItem,
      });

      expect(row).not.toBeNull();
      expect((row?.components[0] as StringSelectMenuBuilder).toJSON().options).toHaveLength(25);
    });

    it('throws when two items produce the same option value', () => {
      const items = [
        sampleItem('dup', 'First duplicate'),
        sampleItem('unique', 'In between'),
        sampleItem('dup', 'Second duplicate'),
      ];

      expect(() =>
        buildBrowseSelectMenu<TestItem>({
          items,
          customId: 'test::select',
          placeholder: 'Pick one...',
          startIndex: 0,
          formatItem: formatTestItem,
        })
      ).toThrow(/duplicate option value "dup"/);
    });
  });

  describe('truncation', () => {
    it('truncates labels longer than the Discord limit, accounting for the numbering prefix', () => {
      // Build a label that's well over the limit. The factory prepends "1. "
      // (3 chars) before truncating, so the visible label must end with the
      // ellipsis and total length === MAX_SELECT_LABEL_LENGTH.
      const veryLongName = 'A'.repeat(MAX_SELECT_LABEL_LENGTH + 50);
      const row = buildBrowseSelectMenu<TestItem>({
        items: [sampleItem('a', veryLongName)],
        customId: 'test::select',
        placeholder: 'Pick one...',
        startIndex: 0,
        formatItem: formatTestItem,
      });

      const label = (row?.components[0] as StringSelectMenuBuilder).toJSON().options[0].label;
      expect(label.length).toBe(MAX_SELECT_LABEL_LENGTH);
      expect(label.endsWith('...')).toBe(true);
      expect(label.startsWith('1. ')).toBe(true);
    });

    it('always strips newlines from labels (Discord renders them poorly)', () => {
      const row = buildBrowseSelectMenu<TestItem>({
        items: [sampleItem('a', 'Multi\nline\nname')],
        customId: 'test::select',
        placeholder: 'Pick one...',
        startIndex: 0,
        formatItem: formatTestItem,
      });

      const label = (row?.components[0] as StringSelectMenuBuilder).toJSON().options[0].label;
      expect(label).not.toContain('\n');
      expect(label).toBe('1. Multi line name');
    });

    it('always strips newlines from descriptions', () => {
      const row = buildBrowseSelectMenu<TestItem>({
        items: [sampleItem('a', 'Alpha', 'desc\nwith\nnewlines')],
        customId: 'test::select',
        placeholder: 'Pick one...',
        startIndex: 0,
        formatItem: formatTestItem,
      });

      const description = (row?.components[0] as StringSelectMenuBuilder).toJSON().options[0]
        .description;
      expect(description).not.toContain('\n');
      expect(description).toBe('desc with newlines');
    });
  });

  describe('generic over item type', () => {
    it('works with any item shape (e.g., domain types)', () => {
      interface Memory {
        memoryId: string;
        content: string;
        isLocked: boolean;
      }

      const memories: Memory[] = [
        { memoryId: 'm1', content: 'first memory', isLocked: false },
        { memoryId: 'm2', content: 'second memory', isLocked: true },
      ];

      const row = buildBrowseSelectMenu<Memory>({
        items: memories,
        customId: 'memory::select',
        placeholder: 'Select a memory...',
        startIndex: 0,
        formatItem: memory => ({
          label: `${memory.isLocked ? '🔒 ' : ''}${memory.content}`,
          value: memory.memoryId,
        }),
      });

      const options = (row?.components[0] as StringSelectMenuBuilder).toJSON().options;
      expect(options[0]).toMatchObject({ label: '1. first memory', value: 'm1' });
      expect(options[1]).toMatchObject({ label: '2. 🔒 second memory', value: 'm2' });
    });
  });
});
