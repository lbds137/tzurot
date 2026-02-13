/**
 * Tests for InspectCustomIds builder/parser
 */

import { describe, it, expect } from 'vitest';
import { InspectCustomIds } from './customIds.js';
import { DebugViewType } from './types.js';

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
    });
  });
});
