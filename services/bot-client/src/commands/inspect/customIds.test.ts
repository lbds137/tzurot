/**
 * Tests for InspectCustomIds builder/parser
 */

import { describe, it, expect } from 'vitest';
import { InspectCustomIds } from './customIds.js';
import { DebugViewType } from './types.js';
import { MEMORY_FILTERS, TOP_N_VALUES, SORT_MODES } from './memoryInspectorState.js';

describe('InspectCustomIds', () => {
  describe('button', () => {
    it('should build a button custom ID', () => {
      const id = InspectCustomIds.button('req-123', DebugViewType.FullJson);
      expect(id).toBe('inspect::btn::req-123::full-json');
    });
  });

  describe('selectMenu', () => {
    it('should build a select menu custom ID', () => {
      const id = InspectCustomIds.selectMenu('req-123');
      expect(id).toBe('inspect::select::req-123');
    });
  });

  describe('parseButton', () => {
    it('should parse a valid button custom ID', () => {
      const result = InspectCustomIds.parseButton('inspect::btn::req-123::full-json');
      expect(result).toEqual({ requestId: 'req-123', viewType: DebugViewType.FullJson });
    });

    it('should return null for wrong prefix', () => {
      expect(InspectCustomIds.parseButton('admin-debug::btn::req-123::full-json')).toBeNull();
    });

    it('should return null for invalid view type', () => {
      expect(InspectCustomIds.parseButton('inspect::btn::req-123::invalid')).toBeNull();
    });

    it('should return null for wrong segment count', () => {
      expect(InspectCustomIds.parseButton('inspect::btn::req-123')).toBeNull();
    });
  });

  describe('parseSelectMenu', () => {
    it('should parse a valid select menu custom ID', () => {
      const result = InspectCustomIds.parseSelectMenu('inspect::select::req-123');
      expect(result).toEqual({ requestId: 'req-123' });
    });

    it('should return null for wrong prefix', () => {
      expect(InspectCustomIds.parseSelectMenu('admin-debug::select::req-123')).toBeNull();
    });

    it('should return null for wrong segment count', () => {
      expect(InspectCustomIds.parseSelectMenu('inspect::select')).toBeNull();
    });
  });

  describe('isInspect', () => {
    it('should return true for inspect custom IDs', () => {
      expect(InspectCustomIds.isInspect('inspect::btn::req::full-json')).toBe(true);
      expect(InspectCustomIds.isInspect('inspect::select::req')).toBe(true);
    });

    it('should return false for other custom IDs', () => {
      expect(InspectCustomIds.isInspect('admin-debug::btn::foo')).toBe(false);
      expect(InspectCustomIds.isInspect('admin-settings::btn::foo')).toBe(false);
    });
  });

  describe('custom ID length', () => {
    it('should stay under Discord 100-char limit', () => {
      const longRequestId = 'a'.repeat(36); // UUID length
      const buttonId = InspectCustomIds.button(longRequestId, DebugViewType.MemoryInspector);
      expect(buttonId.length).toBeLessThan(100);

      const selectId = InspectCustomIds.selectMenu(longRequestId);
      expect(selectId.length).toBeLessThan(100);

      // Memory-state button uses the longest combination
      const memoryId = InspectCustomIds.memoryButton(
        longRequestId,
        'included',
        20,
        'included-first'
      );
      expect(memoryId.length).toBeLessThan(100);
    });
  });

  describe('memoryButton', () => {
    it('builds a 7-segment button with state', () => {
      const id = InspectCustomIds.memoryButton('req-1', 'all', 0, 'score-desc');
      expect(id).toBe('inspect::btn::req-1::memory-inspector::all::0::sd');
    });

    it('uses short-form sort tokens on the wire', () => {
      expect(InspectCustomIds.memoryButton('r', 'all', 0, 'score-desc')).toContain('::sd');
      expect(InspectCustomIds.memoryButton('r', 'all', 0, 'score-asc')).toContain('::sa');
      expect(InspectCustomIds.memoryButton('r', 'all', 0, 'included-first')).toContain('::if');
    });
  });

  describe('parseButton — memory state', () => {
    it('round-trips all 36 (filter × topN × sort) combinations', () => {
      for (const filter of MEMORY_FILTERS) {
        for (const topN of TOP_N_VALUES) {
          for (const sort of SORT_MODES) {
            const built = InspectCustomIds.memoryButton('req-1', filter, topN, sort);
            const parsed = InspectCustomIds.parseButton(built);
            expect(parsed).toEqual({
              requestId: 'req-1',
              viewType: DebugViewType.MemoryInspector,
              memoryState: { filter, topN, sort },
            });
          }
        }
      }
    });

    it('legacy 4-segment memory-inspector button parses without memoryState', () => {
      const result = InspectCustomIds.parseButton('inspect::btn::req-1::memory-inspector');
      expect(result).toEqual({
        requestId: 'req-1',
        viewType: DebugViewType.MemoryInspector,
      });
      expect(result?.memoryState).toBeUndefined();
    });

    it('rejects bad filter token', () => {
      expect(
        InspectCustomIds.parseButton('inspect::btn::req::memory-inspector::bogus::5::sd')
      ).toBeNull();
    });

    it('rejects bad topN token', () => {
      expect(
        InspectCustomIds.parseButton('inspect::btn::req::memory-inspector::all::7::sd')
      ).toBeNull();
    });

    it('rejects non-numeric topN', () => {
      expect(
        InspectCustomIds.parseButton('inspect::btn::req::memory-inspector::all::abc::sd')
      ).toBeNull();
    });

    it('rejects bad sort token', () => {
      expect(
        InspectCustomIds.parseButton('inspect::btn::req::memory-inspector::all::0::xx')
      ).toBeNull();
    });

    it('rejects 7-segment customIds for non-memory view types', () => {
      // Even with valid-looking state segments, only memory-inspector accepts the 7-segment form
      expect(InspectCustomIds.parseButton('inspect::btn::req::full-json::all::0::sd')).toBeNull();
    });

    it('still rejects 5- and 6-segment customIds', () => {
      expect(InspectCustomIds.parseButton('inspect::btn::req::memory-inspector::all')).toBeNull();
      expect(
        InspectCustomIds.parseButton('inspect::btn::req::memory-inspector::all::0')
      ).toBeNull();
    });

    it('regression: 4-segment buttons for other view types still parse', () => {
      // Sanity check that the relaxation didn't break the legacy path
      const result = InspectCustomIds.parseButton('inspect::btn::req::full-json');
      expect(result).toEqual({
        requestId: 'req',
        viewType: DebugViewType.FullJson,
      });
    });
  });
});
