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
  it('renders an OpenRouter model: provider author, slug, short price, access, link', () => {
    const embed = buildModelCard(
      usable({ id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' })
    );
    const json = embed.toJSON();
    expect(json.title).toBe('Claude Sonnet 4');
    expect(json.author?.name).toBe('anthropic'); // from slug (no "Provider: " prefix in name)
    expect(json.color).toBe(0x5865f2); // detail cards stay BLURPLE (§2.3)
    expect(json.description).toContain('`anthropic/claude-sonnet-4`');
    expect(json.description).toContain('✅ **You can use this**');
    const fields = json.fields ?? [];
    expect(fields.find(f => f.name === 'Context')?.value).toBe('200K tokens');
    expect(fields.find(f => f.name === 'Price')?.value).toBe('$3.00 / $15.00');
    expect(fields.find(f => f.name === 'Access')?.value).toBe('Ready');
    expect(fields.find(f => f.name === 'Links')?.value).toContain('OpenRouter model page');
    expect(json.footer?.text).toContain('per 1M tokens');
  });

  it('splits a "Provider: Model" name into author + bare title', () => {
    const json = buildModelCard(
      usable({ id: 'ai21/jamba-large-1.7', name: 'AI21: Jamba Large 1.7' })
    ).toJSON();
    expect(json.author?.name).toBe('AI21');
    expect(json.title).toBe('Jamba Large 1.7');
  });

  it('renders a z.ai-only model: z.ai-plan price, z.ai marker, docs link, orange (needs key)', () => {
    const json = buildModelCard(
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
    ).toJSON();
    const fields = json.fields ?? [];
    expect(json.color).toBe(0x5865f2); // detail cards stay BLURPLE (§2.3)
    expect(fields.find(f => f.name === 'Context')?.value).toBe('1M tokens');
    expect(fields.find(f => f.name === 'Price')?.value).toBe('z.ai plan');
    expect(fields.find(f => f.name === 'Access')?.value).toBe('z.ai key');
    expect(json.description).toContain('⚡ z.ai coding-plan');
    expect(json.description).toContain('🔑 **Needs a z.ai');
    expect(fields.find(f => f.name === 'Links')?.value).toContain('z.ai docs');
    expect(fields.find(f => f.name === 'Links')?.value).not.toContain('OpenRouter');
    expect(json.footer?.text).toBe('via z.ai coding plan');
  });

  it('renders "Variable" price (not a negative number) for an auto-router', () => {
    const fields =
      buildModelCard(
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
      ).toJSON().fields ?? [];
    expect(fields.find(f => f.name === 'Price')?.value).toBe('Variable');
  });

  it('names both key paths for a both-source model with no keys', () => {
    const json = buildModelCard(
      usable({
        id: 'z-ai/glm-5',
        name: 'Z.ai: GLM 5',
        isZaiCoding: true,
        source: 'both',
        usability: 'needs-either-key',
        canUse: false,
      })
    ).toJSON();
    expect(json.description).toContain('OpenRouter or z.ai');
    expect(json.color).toBe(0x5865f2); // detail cards stay BLURPLE (§2.3)
    // 'both' source routes via OpenRouter (shown pricing) OR a z.ai key — the
    // footer names both so a z.ai-key-only viewer isn't misled.
    expect(json.footer?.text).toContain('via OpenRouter (also z.ai coding-plan)');
  });

  it('renders the meta-router marker in the capability line', () => {
    const json = buildModelCard(
      usable({
        id: 'openrouter/auto',
        name: 'Auto Router',
        isRouter: true,
        hasPricing: false,
        usability: 'needs-openrouter-key',
        canUse: false,
      })
    ).toJSON();
    expect(json.description).toContain('🔀 meta-router');
  });

  it('renders the unverified (unknown) state without claiming a key is needed', () => {
    const json = buildModelCard(
      usable({
        id: 'anthropic/claude-sonnet-4',
        name: 'Claude Sonnet 4',
        usability: 'unknown',
        canUse: false,
      })
    ).toJSON();
    expect(json.description).toContain("❔ **Couldn't verify your keys**");
    expect(json.description).not.toContain('Needs');
    expect((json.fields ?? []).find(f => f.name === 'Access')?.value).toBe('Unverified');
  });

  it('shows the free usability line for free models', () => {
    expect(
      buildModelCard(usable({ id: 'google/gemma:free', usability: 'free', canUse: true })).toJSON()
        .description
    ).toContain('🆓 **Free**');
  });

  it('renders capability emojis for a vision model', () => {
    expect(
      buildModelCard(usable({ id: 'x/vision', supportsVision: true })).toJSON().description
    ).toContain('👁️ vision');
  });
});
