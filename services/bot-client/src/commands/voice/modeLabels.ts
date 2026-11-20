/**
 * Human labels for the resolved Voice Response Mode — shared by `/voice view`
 * (read-only render) and `/voice replies` (write confirmation) so both
 * surfaces name a tier the same way.
 *
 * The labels live apart from `ttsSourceLabel`: the TTS resolution and the
 * config cascade have different source enums, and the mode labels name the
 * command that changes the tier so the surfaces bridge to it.
 */

import { type VoiceResponseModeView } from '@tzurot/common-types/schemas/api/voice-resolution';
import { type ConfigOverrideSource } from '@tzurot/common-types/schemas/api/configOverrides';

/** Label for the cascade tier that supplied the resolved Voice Response Mode. */
export function voiceModeSourceLabel(source: ConfigOverrideSource): string {
  switch (source) {
    case 'user-personality':
      return 'your override for this character';
    case 'user-default':
      return 'your default for every character';
    case 'personality':
      return "the character's default";
    case 'channel':
      return "this channel's setting";
    case 'admin':
      return 'bot-wide setting';
    case 'hardcoded':
      return 'built-in default';
  }
}

/** Human label for the resolved Voice Response Mode value. */
export function voiceModeValueLabel(value: VoiceResponseModeView['value']): string {
  switch (value) {
    case 'always':
      return 'Always';
    case 'voice-only':
      return 'Only when you send voice';
    case 'never':
      return 'Never';
  }
}
