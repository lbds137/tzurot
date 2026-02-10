import { describe, it, expect } from 'vitest';
import { DebugCustomIds } from './customIds.js';
import { DebugViewType } from './types.js';

describe('DebugCustomIds', () => {
  describe('button', () => {
    it('should build a button custom ID with prefix, requestId, and viewType', () => {
      const id = DebugCustomIds.button('abc-123', DebugViewType.FullJson);
      expect(id).toBe('admin-debug::btn::abc-123::full-json');
    });

    it('should build distinct IDs for each view type', () => {
      const ids = Object.values(DebugViewType).map(vt => DebugCustomIds.button('req-1', vt));
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });
  });

  describe('selectMenu', () => {
    it('should build a select menu custom ID', () => {
      const id = DebugCustomIds.selectMenu('abc-123');
      expect(id).toBe('admin-debug::select::abc-123');
    });
  });

  describe('parseButton', () => {
    it('should round-trip with button builder', () => {
      const requestId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const viewType = DebugViewType.Reasoning;
      const customId = DebugCustomIds.button(requestId, viewType);
      const parsed = DebugCustomIds.parseButton(customId);

      expect(parsed).toEqual({ requestId, viewType });
    });

    it('should return null for non-debug custom IDs', () => {
      expect(DebugCustomIds.parseButton('admin-settings::btn::foo')).toBeNull();
    });

    it('should return null for select menu custom IDs', () => {
      expect(DebugCustomIds.parseButton('admin-debug::select::req')).toBeNull();
    });

    it('should return null for invalid view type', () => {
      expect(DebugCustomIds.parseButton('admin-debug::btn::req::invalid-view')).toBeNull();
    });
  });

  describe('parseSelectMenu', () => {
    it('should round-trip with selectMenu builder', () => {
      const requestId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const customId = DebugCustomIds.selectMenu(requestId);
      const parsed = DebugCustomIds.parseSelectMenu(customId);

      expect(parsed).toEqual({ requestId });
    });

    it('should return null for button custom IDs', () => {
      expect(DebugCustomIds.parseSelectMenu('admin-debug::btn::req::full-json')).toBeNull();
    });

    it('should return null for non-debug custom IDs', () => {
      expect(DebugCustomIds.parseSelectMenu('admin-settings::select::foo')).toBeNull();
    });
  });

  describe('isDebug', () => {
    it('should return true for debug button custom IDs', () => {
      expect(DebugCustomIds.isDebug('admin-debug::btn::req::full-json')).toBe(true);
    });

    it('should return true for debug select custom IDs', () => {
      expect(DebugCustomIds.isDebug('admin-debug::select::req')).toBe(true);
    });

    it('should return false for other prefixes', () => {
      expect(DebugCustomIds.isDebug('admin-settings::btn::foo')).toBe(false);
      expect(DebugCustomIds.isDebug('character::seed')).toBe(false);
    });

    it('should return false for partial prefix match without delimiter', () => {
      expect(DebugCustomIds.isDebug('admin-debugsomething')).toBe(false);
    });
  });

  describe('custom ID length', () => {
    it('should stay under Discord 100-char limit with max-length UUID', () => {
      const longUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const longestView = DebugViewType.MemoryInspector; // "memory-inspector" = 16 chars

      const buttonId = DebugCustomIds.button(longUuid, longestView);
      expect(buttonId.length).toBeLessThan(100);

      const selectId = DebugCustomIds.selectMenu(longUuid);
      expect(selectId.length).toBeLessThan(100);
    });
  });
});
