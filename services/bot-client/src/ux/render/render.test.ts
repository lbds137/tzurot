import { describe, it, expect } from 'vitest';
import { renderSpec } from './render.js';
import { CATALOG } from '../catalog/catalog.js';
import type { MessageSpec } from '../catalog/types.js';

describe('renderSpec', () => {
  it('prefixes the severity emoji (the single glyph source)', () => {
    expect(renderSpec(CATALOG.error.notFound('Preset'))).toBe('❌ Preset not found.');
    expect(renderSpec(CATALOG.success.done('Saved.'))).toBe('✅ Saved.');
    expect(renderSpec(CATALOG.error.transient('Server hiccup.'))).toMatch(/^⚠️ /);
  });

  it('icon tokens override the severity default (session-expiry ⏰, loading 🔄)', () => {
    expect(renderSpec(CATALOG.progress.sessionExpired())).toMatch(/^⏰ /);
    expect(renderSpec(CATALOG.progress.working('Importing'))).toMatch(/^🔄 /);
  });

  describe('register selection (voice axis)', () => {
    const dual: MessageSpec = {
      severity: 'warning',
      outcome: 'failed',
      text: 'The model is rate limited right now.',
      personaText: '*rubs temples* My thoughts are moving slowly right now — give me a moment.',
    };

    it('persona register selects personaText when present', () => {
      expect(renderSpec(dual, { register: 'persona' })).toContain('rubs temples');
    });

    it('system register (default) never renders persona text', () => {
      expect(renderSpec(dual)).not.toContain('rubs temples');
      expect(renderSpec(dual, { register: 'system' })).not.toContain('rubs temples');
    });

    it('persona register FALLS BACK to system text when no persona rendering exists', () => {
      // The renderer must never invent persona-flavored text (design §4.2).
      const systemOnly = CATALOG.error.permissionDenied('edit this');
      expect(renderSpec(systemOnly, { register: 'persona' })).toBe(
        renderSpec(systemOnly, { register: 'system' })
      );
    });
  });
});
