/**
 * Tests for the deprecation-stub redirect helper used by /settings tts
 * and /settings voices after the /voice consolidation.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  SETTINGS_TO_VOICE_REDIRECTS,
  redirectToVoiceCommand,
  tryRedirectToVoice,
} from './redirectToVoiceCommand.js';

function makeContext() {
  return {
    user: { id: 'discord-user-1' },
    interaction: {} as never,
    editReply: vi.fn(),
  };
}

describe('SETTINGS_TO_VOICE_REDIRECTS table', () => {
  it('maps every legacy /settings tts subcommand to its new /voice tts path', () => {
    expect(SETTINGS_TO_VOICE_REDIRECTS['tts set']).toBe('/voice tts set');
    expect(SETTINGS_TO_VOICE_REDIRECTS['tts reset']).toBe('/voice tts clear');
    expect(SETTINGS_TO_VOICE_REDIRECTS['tts default']).toBe('/voice tts set-default');
    expect(SETTINGS_TO_VOICE_REDIRECTS['tts clear-default']).toBe('/voice tts clear-default');
    expect(SETTINGS_TO_VOICE_REDIRECTS['tts browse']).toBe('/voice tts browse');
  });

  it('maps every legacy /settings voices subcommand to its new /voice voices path', () => {
    expect(SETTINGS_TO_VOICE_REDIRECTS['voices browse']).toBe('/voice voices browse');
    expect(SETTINGS_TO_VOICE_REDIRECTS['voices clear']).toBe('/voice voices clear');
    expect(SETTINGS_TO_VOICE_REDIRECTS['voices delete']).toBe('/voice voices delete');
  });
});

describe('redirectToVoiceCommand', () => {
  it('sends an ephemeral message naming the new path', async () => {
    const context = makeContext();
    await redirectToVoiceCommand(context as never, '/voice tts set');

    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('/voice tts set'),
      })
    );
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('moved'),
      })
    );
  });
});

describe('tryRedirectToVoice', () => {
  it('returns true and routes for a known legacy subcommand', async () => {
    const context = makeContext();
    const handled = await tryRedirectToVoice(context as never, 'tts', 'reset');

    expect(handled).toBe(true);
    expect(context.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('/voice tts clear'),
      })
    );
  });

  it('returns false and does nothing for an unknown subcommand', async () => {
    const context = makeContext();
    const handled = await tryRedirectToVoice(context as never, 'tts', 'unknown-sub');

    expect(handled).toBe(false);
    expect(context.editReply).not.toHaveBeenCalled();
  });
});
