/**
 * Tests for the alias data model: filter cycle + scope filtering.
 */

import { describe, it, expect } from 'vitest';
import { applyFilter, type AliasRow } from './aliasData.js';

const rows: AliasRow[] = [
  { alias: 'a', scope: 'user', shadowed: false, character: { name: null, slug: 's' } },
  { alias: 'b', scope: 'global', shadowed: false, character: { name: null, slug: 's' } },
];

describe('alias data model', () => {
  describe('applyFilter', () => {
    it('narrows to the selected scope and passes everything for all', () => {
      expect(applyFilter(rows, 'all')).toHaveLength(2);
      expect(applyFilter(rows, 'mine').map(row => row.alias)).toEqual(['a']);
      expect(applyFilter(rows, 'global').map(row => row.alias)).toEqual(['b']);
    });
  });
});
