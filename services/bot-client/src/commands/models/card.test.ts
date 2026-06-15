/**
 * Tests for the model detail card embed builder.
 */

import { describe, it, expect } from 'vitest';
import { buildModelCard } from './card.js';
import type { UsableCatalogModel } from '../../utils/modelCatalog.js';

function usable(overrides: Partial<UsableCatalogModel> & { id: string }): UsableCatalogModel {
  return {
    name: overrides.id,
    contextLength: 200_000,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 3,
    completionPricePerMillion: 15,
    isZaiCoding: false,
    docsUrl: null,
    source: 'openrouter',
    hasPricing: true,
    usability: 'usable',
    canUse: true,
    ...overrides,
  };
}

describe('buildModelCard', () => {
  it('renders an OpenRouter model with slug, context, pricing, and OpenRouter link', () => {
    const embed = buildModelCard(
      usable({ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' })
    );
    const json = embed.toJSON();
    expect(json.title).toBe('Claude Sonnet 4');
    expect(json.description).toContain('`anthropic/claude-sonnet-4`');
    expect(json.description).toContain('✅ You can use this');
    const fields = json.fields ?? [];
    expect(fields.find(f => f.name === 'Context')?.value).toContain('200K');
    expect(fields.find(f => f.name === 'Pricing')?.value).toContain('$3.00 in / $15.00 out');
    expect(fields.find(f => f.name === 'Links')?.value).toContain('OpenRouter model page');
  });

  it('renders a z.ai-only model with BYOK pricing, z.ai field, and docs link', () => {
    const embed = buildModelCard(
      usable({
        id: 'z-ai/glm-5.2',
        name: 'GLM-5.2',
        contextLength: 1_000_000,
        isZaiCoding: true,
        docsUrl: 'https://docs.z.ai/guides/llm/glm-5.2',
        source: 'zai-catalog',
        hasPricing: false,
        usability: 'needs-zai-key',
        canUse: false,
      })
    );
    const json = embed.toJSON();
    const fields = json.fields ?? [];
    expect(fields.find(f => f.name === 'Context')?.value).toContain('1M');
    expect(fields.find(f => f.name === 'Pricing')?.value).toContain('bring your own key');
    expect(fields.some(f => f.name === 'z.ai coding plan')).toBe(true);
    expect(fields.find(f => f.name === 'Links')?.value).toContain('z.ai docs');
    expect(fields.find(f => f.name === 'Links')?.value).not.toContain('OpenRouter');
    expect(json.description).toContain('🔒 Needs a z.ai');
  });

  it('renders "Variable" pricing for a negative-priced auto-router', () => {
    const embed = buildModelCard(
      usable({
        id: 'openrouter/auto',
        name: 'Auto Router',
        promptPricePerMillion: -1_000_000,
        completionPricePerMillion: -1_000_000,
        hasPricing: false,
        source: 'openrouter',
        usability: 'needs-openrouter-key',
        canUse: false,
      })
    );
    const fields = embed.toJSON().fields ?? [];
    expect(fields.find(f => f.name === 'Pricing')?.value).toContain('Variable');
    expect(fields.find(f => f.name === 'Pricing')?.value).not.toContain('-');
  });

  it('names both key paths for a both-source model with no keys', () => {
    const embed = buildModelCard(
      usable({
        id: 'z-ai/glm-5',
        name: 'GLM-5',
        isZaiCoding: true,
        source: 'both',
        usability: 'needs-either-key',
        canUse: false,
      })
    );
    expect(embed.toJSON().description).toContain('OpenRouter or z.ai');
  });

  it('shows the free usability line for free models', () => {
    const embed = buildModelCard(
      usable({ id: 'google/gemma:free', usability: 'free', canUse: true })
    );
    expect(embed.toJSON().description).toContain('🆓 Free');
  });

  it('renders capability emojis for a vision model', () => {
    const embed = buildModelCard(usable({ id: 'x/vision', supportsVision: true }));
    expect(embed.toJSON().description).toContain('👁️ vision');
  });
});
