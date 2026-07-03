/**
 * Consumer half of the voice-engine JSON contract (Python producer → TS consumer).
 *
 * Reads the SAME committed fixtures the Python PRODUCER test
 * (`services/voice-engine/tests/test_contract.py`) asserts its real endpoint output
 * against, and validates each against the Zod schema `VoiceEngineClient` parses
 * responses with. The committed fixture is the shared cross-language artifact —
 * neither side imports the other.
 *
 * Drift is caught on BOTH sides, structurally: a Python field rename breaks the
 * Python fixture-equality assert; regenerating the fixture then breaks the Zod
 * `.parse` here. Both CI jobs (`voice-engine-tests` + `component-integration-tests`, which runs
 * `pnpm test:integration`) run on every PR, so a one-sided fixture change can't merge.
 */

import { describe, it, expect } from 'vitest';
import { loadContractFixture } from '@tzurot/test-utils';

import {
  transcribeResponseSchema,
  healthResponseSchema,
  voicesResponseSchema,
} from './voiceEngineSchemas.js';

describe('Contract: voice-engine JSON responses (Python producer fixtures → TS Zod schemas)', () => {
  it('transcribe fixture validates + exposes the `text` the client reads', () => {
    const parsed = transcribeResponseSchema.parse(
      loadContractFixture('voice-engine/transcribe.json')
    );
    expect(parsed.text).toBeTypeOf('string');
  });

  it('health fixture validates against the health schema', () => {
    const parsed = healthResponseSchema.parse(loadContractFixture('voice-engine/health.json'));
    expect(parsed.asr_loaded).toBeTypeOf('boolean');
    expect(parsed.tts_loaded).toBeTypeOf('boolean');
  });

  it('voices fixture validates + carries the { id, type } item shape', () => {
    const parsed = voicesResponseSchema.parse(loadContractFixture('voice-engine/voices.json'));
    expect(parsed.voices[0].id).toBeTypeOf('string');
  });
});
