import { describe, it, expect } from 'vitest';
import { generateClonedName, stripCopySuffix } from './presetCloneName.js';

describe('generateClonedName', () => {
  it('adds (Copy) to a name with no suffix', () => {
    expect(generateClonedName('Preset')).toBe('Preset (Copy)');
  });

  it('bumps (Copy) to (Copy 2)', () => {
    expect(generateClonedName('Preset (Copy)')).toBe('Preset (Copy 2)');
  });

  it('bumps (Copy N) to (Copy N+1)', () => {
    expect(generateClonedName('Preset (Copy 2)')).toBe('Preset (Copy 3)');
    expect(generateClonedName('Preset (Copy 9)')).toBe('Preset (Copy 10)');
  });

  it('picks max across multiple trailing suffixes', () => {
    // two plain (Copy)s → max of (1,1) is 1, next is 2
    expect(generateClonedName('Preset (Copy) (Copy)')).toBe('Preset (Copy 2)');
    // (Copy 5) + plain (Copy) → max of (5,1) is 5, next is 6
    expect(generateClonedName('Preset (Copy 5) (Copy)')).toBe('Preset (Copy 6)');
  });

  it('trims whitespace from the original name', () => {
    expect(generateClonedName('  Preset  ')).toBe('Preset (Copy)');
  });

  it('is case-insensitive on the word "Copy"', () => {
    expect(generateClonedName('Preset (copy)')).toBe('Preset (Copy 2)');
    expect(generateClonedName('Preset (COPY 3)')).toBe('Preset (Copy 4)');
  });

  it('preserves internal whitespace in the base name', () => {
    expect(generateClonedName('My Fancy Preset')).toBe('My Fancy Preset (Copy)');
  });
});

describe('stripCopySuffix', () => {
  it('returns name unchanged when there is no suffix', () => {
    expect(stripCopySuffix('Preset')).toBe('Preset');
  });

  it('strips a single (Copy) suffix', () => {
    expect(stripCopySuffix('Preset (Copy)')).toBe('Preset');
  });

  it('strips a numeric (Copy N) suffix', () => {
    expect(stripCopySuffix('Preset (Copy 5)')).toBe('Preset');
  });

  it('strips multiple stacked trailing suffixes', () => {
    expect(stripCopySuffix('Preset (Copy) (Copy 3)')).toBe('Preset');
    expect(stripCopySuffix('Preset (Copy 2) (Copy) (Copy 7)')).toBe('Preset');
  });

  it('only strips TRAILING suffixes, not mid-string', () => {
    expect(stripCopySuffix('(Copy) of Preset')).toBe('(Copy) of Preset');
  });

  it('trims whitespace after stripping', () => {
    expect(stripCopySuffix('Preset   (Copy)')).toBe('Preset');
  });

  it('handles empty string', () => {
    expect(stripCopySuffix('')).toBe('');
  });
});
