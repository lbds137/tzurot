import { describe, it, expect } from 'vitest';
import { MEMORY_NAMESPACE, deterministicMemoryUuid } from './memory.js';

describe('memory constants', () => {
  it('produces deterministic memory UUIDs', () => {
    const id1 = deterministicMemoryUuid('persona-1', 'personality-1', 'content');
    const id2 = deterministicMemoryUuid('persona-1', 'personality-1', 'content');
    expect(id1).toBe(id2);
    expect(MEMORY_NAMESPACE).toBeDefined();
  });
});
