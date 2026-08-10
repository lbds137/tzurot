/**
 * Pins the shared builder's computed defaults — the drift between hand-rolled
 * copies of exactly these two fields is what motivated the builder, so the
 * derivation itself gets a test (same precedent as gatewayClientStubs.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { catalogModel } from './catalogModel.js';

describe('catalogModel builder defaults', () => {
  it('computes zai-catalog source and isZaiCoding for a real coding-plan model id', () => {
    const model = catalogModel({ id: 'z-ai/glm-5.2' });
    expect(model.isZaiCoding).toBe(true);
    expect(model.source).toBe('zai-catalog');
  });

  it('treats a z-ai/-prefixed id that is NOT a coding-plan model as openrouter (membership, not prefix)', () => {
    const model = catalogModel({ id: 'z-ai/not-a-real-model' });
    expect(model.isZaiCoding).toBe(false);
    expect(model.source).toBe('openrouter');
  });

  it('computes openrouter defaults for a non-z-ai id', () => {
    const model = catalogModel({ id: 'anthropic/claude-sonnet-4' });
    expect(model.isZaiCoding).toBe(false);
    expect(model.source).toBe('openrouter');
  });

  it('lets explicit overrides win over the computed defaults', () => {
    const model = catalogModel({ id: 'z-ai/glm-5.2', source: 'openrouter', isZaiCoding: false });
    expect(model.isZaiCoding).toBe(false);
    expect(model.source).toBe('openrouter');
  });
});
