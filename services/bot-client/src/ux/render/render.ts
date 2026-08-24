/**
 * Discord renderer for MessageSpecs — glyphs, register selection, markdown.
 *
 * The SINGLE source of the emoji map (design §4.2): error ❌ · warning ⚠️ ·
 * success ✅ · progress ⏳ · session-expiry ⏰ · loading 🔄. Call sites never
 * hand-write these prefixes; migrating a literal onto the catalog is what
 * shrinks a file's `@tzurot/no-raw-content-literals` budget.
 */

import type { MessageIcon, MessageSeverity, MessageSpec } from '../catalog/types.js';
import { noteRenderedOutcome } from '../../observability/commandOutcomeSlot.js';

/** Severity → default glyph. Icon tokens override (session-expiry, loading). */
const SEVERITY_EMOJI: Record<MessageSeverity, string> = {
  error: '❌',
  warning: '⚠️',
  success: '✅',
  info: 'ℹ️',
  progress: '⏳',
};

const ICON_EMOJI: Record<MessageIcon, string> = {
  ...SEVERITY_EMOJI,
  'session-expiry': '⏰',
  loading: '🔄',
};

export interface RenderOptions {
  /**
   * Voice register. `persona` selects `personaText` when the spec carries one
   * (persona-eligible intents); specs without a persona rendering fall back
   * to the system register — the renderer never invents persona-flavored
   * text (design §4.2 voice axis).
   */
  register?: 'system' | 'persona';
}

/** Render a MessageSpec to a Discord content string (emoji prefix + text). */
export function renderSpec(spec: MessageSpec, opts: RenderOptions = {}): string {
  // Command-telemetry seam: no-op outside an active command invocation (see
  // commandOutcomeSlot.ts) — this is the universal render choke point, so
  // it's the one place that can observe a `failed` outcome without touching
  // the other 335 call sites.
  noteRenderedOutcome(spec);
  const emoji = spec.icon !== undefined ? ICON_EMOJI[spec.icon] : SEVERITY_EMOJI[spec.severity];
  const text =
    opts.register === 'persona' && spec.personaText !== undefined ? spec.personaText : spec.text;
  return `${emoji} ${text}`;
}
