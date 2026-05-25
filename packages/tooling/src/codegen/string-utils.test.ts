import { describe, it, expect } from 'vitest';
import { capitalizeFirst } from './string-utils.js';

describe('capitalizeFirst', () => {
  it('uppercases the first character', () => {
    expect(capitalizeFirst('foo')).toBe('Foo');
  });

  it('preserves the rest of the string unchanged (camelCase → PascalCase)', () => {
    expect(capitalizeFirst('getRecentDiagnostics')).toBe('GetRecentDiagnostics');
    expect(capitalizeFirst('aiGenerate')).toBe('AiGenerate');
  });

  it('is a no-op on an empty string', () => {
    expect(capitalizeFirst('')).toBe('');
  });

  it('is a no-op when the first character is already uppercase', () => {
    expect(capitalizeFirst('Foo')).toBe('Foo');
  });

  it('does NOT handle multi-segment identifiers (documented limitation)', () => {
    // Documents the function's narrow scope — `kebab-case` and `snake_case`
    // input is not normalized. The manifest's per-audience invariant tests
    // enforce camelCase ids, so non-camelCase input never reaches here in
    // practice, but if it did, the result would be wrong:
    expect(capitalizeFirst('get-timezone')).toBe('Get-timezone');
    expect(capitalizeFirst('get_timezone')).toBe('Get_timezone');
  });
});
