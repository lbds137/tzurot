/**
 * TtsProviderRegistry
 *
 * Module-level lazy singleton registry of `TtsProvider` instances. The
 * dispatcher (`TtsDispatcher.dispatchTts`) consumes the `TtsProviderRegistry`
 * interface from this module to resolve provider ids → instances at call time.
 *
 * Construction is lazy: providers are instantiated on first `getProvider()` /
 * `listProviderIds()` call. Self-hosted is omitted entirely if the voice-engine
 * client cannot be constructed (VOICE_ENGINE_URL not set) — the dispatcher
 * skips ids it cannot resolve, so the chain naturally degrades.
 *
 * Test isolation: `resetTtsProviderRegistry()` clears the cached instances so
 * each test starts with a fresh registry. Use it in `beforeEach`.
 */

import {
  type TtsProvider,
  type TtsProviderId,
} from '@tzurot/common-types/services/tts/TtsProvider';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { TtsProviderRegistry } from './TtsDispatcher.js';
import { ElevenLabsTtsProvider } from './providers/ElevenLabsTtsProvider.js';
import { MistralTtsProvider } from './providers/MistralTtsProvider.js';
import { SelfHostedTtsProvider } from './providers/SelfHostedTtsProvider.js';
import { ElevenLabsVoiceService } from './ElevenLabsVoiceService.js';
import { VoiceRegistrationService } from './VoiceRegistrationService.js';
import { getVoiceEngineClient } from './VoiceEngineClient.js';

const logger = createLogger('ttsProviderRegistry');

/**
 * Registration order. Iteration matters for the dispatcher's fallback chain
 * construction (after the resolved primary, the dispatcher walks remaining
 * registered providers in order, then appends self-hosted last).
 *
 * Putting self-hosted at the end here is mostly cosmetic — the dispatcher
 * has its own logic that always slots self-hosted as the safety net — but
 * keeps the registration-order list intuitive for anyone reading it.
 */
const REGISTRATION_ORDER: readonly TtsProviderId[] = ['elevenlabs', 'mistral', 'self-hosted'];

let _instances: Map<TtsProviderId, TtsProvider> | null = null;

/**
 * Build the providers map. Self-hosted is conditional on `VOICE_ENGINE_URL`
 * being configured; if absent, the registry simply doesn't include it and
 * the dispatcher falls through.
 */
function buildInstances(): Map<TtsProviderId, TtsProvider> {
  const instances = new Map<TtsProviderId, TtsProvider>();

  instances.set('elevenlabs', new ElevenLabsTtsProvider(new ElevenLabsVoiceService()));
  instances.set('mistral', new MistralTtsProvider());

  const voiceEngineClient = getVoiceEngineClient();
  if (voiceEngineClient !== null) {
    instances.set(
      'self-hosted',
      new SelfHostedTtsProvider(new VoiceRegistrationService(voiceEngineClient))
    );
  } else {
    logger.warn(
      'VOICE_ENGINE_URL not configured — self-hosted TTS provider omitted from registry. Fallback chain will not include the safety net.'
    );
  }

  return instances;
}

function ensureInstances(): Map<TtsProviderId, TtsProvider> {
  _instances ??= buildInstances();
  return _instances;
}

/**
 * The default module-level registry the production code uses. Tests should
 * either inject a stub registry into `dispatchTts({...registry: stub})` or
 * call `resetTtsProviderRegistry()` between cases.
 */
export const ttsProviderRegistry: TtsProviderRegistry = {
  getProvider(id: TtsProviderId): TtsProvider | undefined {
    return ensureInstances().get(id);
  },
  listProviderIds(): readonly TtsProviderId[] {
    const instances = ensureInstances();
    return REGISTRATION_ORDER.filter(id => instances.has(id));
  },
};

/** @internal Test-only — reset cached singleton so the next call rebuilds. */
export function resetTtsProviderRegistry(): void {
  _instances = null;
}
