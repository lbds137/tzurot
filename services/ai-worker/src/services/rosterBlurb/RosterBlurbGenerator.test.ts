import { describe, expect, it, vi } from 'vitest';

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { generateRosterBlurb } from './RosterBlurbGenerator.js';
import {
  ROSTER_BLURB_CARD_FIELDS,
  type RosterBlurbCard,
} from '@tzurot/common-types/utils/rosterBlurbCard';
import { buildRosterBlurbPrompt, ROSTER_BLURB_MAX_LENGTH } from './rosterBlurbPrompt.js';
import type { SystemModelResult } from '../systemModel/systemModelCall.js';

function card(): RosterBlurbCard {
  return {
    ...(Object.fromEntries(ROSTER_BLURB_CARD_FIELDS.map(k => [k, null])) as RosterBlurbCard),
    name: 'Ilana',
    characterInfo: 'You are Ilana, a dry-witted archivist.',
  };
}

function respondWith(content: string): SystemModelResult {
  return { content, tokensIn: 120, tokensOut: 40, provider: AIProvider.OpenRouter };
}

describe('generateRosterBlurb', () => {
  it('hands the invoker the prompt built from the card', async () => {
    const invoke = vi.fn().mockResolvedValue(respondWith('{"blurb":"Ilana is an archivist."}'));

    await generateRosterBlurb(card(), invoke);

    expect(invoke).toHaveBeenCalledWith(buildRosterBlurbPrompt(card()));
  });

  it('returns the parsed blurb with the call cost', async () => {
    const invoke = vi.fn().mockResolvedValue(respondWith('{"blurb":"Ilana is an archivist."}'));

    const result = await generateRosterBlurb(card(), invoke);

    expect(result.blurb).toBe('Ilana is an archivist.');
    expect(result.usage.tokensIn).toBe(120);
    expect(result.usage.tokensOut).toBe(40);
  });

  it('unwraps a markdown-fenced response', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue(respondWith('```json\n{"blurb":"Ilana is an archivist."}\n```'));

    expect((await generateRosterBlurb(card(), invoke)).blurb).toBe('Ilana is an archivist.');
  });

  it('accepts an empty blurb as a real answer, not a failure', async () => {
    const invoke = vi.fn().mockResolvedValue(respondWith('{"blurb":""}'));

    expect((await generateRosterBlurb(card(), invoke)).blurb).toBe('');
  });

  it('fails to skip on a response that is not JSON', async () => {
    const invoke = vi.fn().mockResolvedValue(respondWith('Ilana is an archivist.'));

    const result = await generateRosterBlurb(card(), invoke);

    expect(result.blurb).toBeNull();
    // The tokens were still spent — the caller must be able to bill them.
    expect(result.usage.tokensIn).toBe(120);
  });

  it('fails to skip on a response missing the blurb key', async () => {
    const invoke = vi.fn().mockResolvedValue(respondWith('{"description":"Ilana"}'));

    expect((await generateRosterBlurb(card(), invoke)).blurb).toBeNull();
  });

  it('fails to skip on a blurb past the cap', async () => {
    const over = 'a'.repeat(ROSTER_BLURB_MAX_LENGTH + 1);
    const invoke = vi.fn().mockResolvedValue(respondWith(JSON.stringify({ blurb: over })));

    expect((await generateRosterBlurb(card(), invoke)).blurb).toBeNull();
  });
});
