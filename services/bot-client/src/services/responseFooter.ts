/**
 * Response footer
 *
 * Builds the `-#` subtext footer appended to a character reply (model
 * indicator, mode badges, bot-owner TTS notices). Pure, so both the first send
 * (`DiscordResponseSender`) and an in-place rewrite of an existing reply
 * (reroll) render the footer from the same rules.
 */

import { escapeMarkdown } from 'discord.js';
import { GUEST_MODE, buildModelInfoUrl } from '@tzurot/common-types/constants/ai';
import {
  BOT_FOOTER_TEXT,
  buildModelFooterText,
  buildPiggybackNoteLine,
} from '@tzurot/common-types/constants/discord';
import { type QuotaFallbackCategoryValue } from '@tzurot/common-types/constants/error';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';

/** The response options that decide what the footer says. */
export interface ResponseFooterOptions {
  /** Model name used for generation (optional, adds indicator) */
  modelUsed?: string;
  /**
   * Effective provider that served the request (e.g., 'openrouter', 'zai-coding').
   * Used to pick the right model-info URL for the footer link. When undefined,
   * the footer link falls back to OpenRouter's model card page.
   */
  providerUsed?: string;
  /**
   * Provider of the auto-promotion fallback attempt that ALSO failed — set
   * only on a both-routes-failed error result. Renders the footer attribution
   * as a route chain ("via Z.AI Coding Plan → OpenRouter (both routes failed)").
   */
  fallbackProviderAttempted?: string;
  /**
   * The configured (or auto-promoted) provider a SERVED fallback swap routed
   * away from — `providerUsed` is then the route that served the response.
   * Renders the footer attribution as a route chain so a same-model swap is
   * visibly a fallback. Set whenever a served swap preceded the result,
   * including the empty-response failure result; the both-routes-failed
   * error carries `fallbackProviderAttempted` instead.
   */
  fallbackFromProvider?: string;
  /**
   * `true` when the request was configured for `zai-coding` and ProviderRouter
   * redirected it to OpenRouter upfront because the user had no coding-plan
   * key. Forwarded to `buildModelFooterText` to annotate the via-OpenRouter
   * attribution (`• via OpenRouter (no coding plan key)`).
   */
  fallthroughTriggered?: boolean;
  /**
   * Tier-aware quota fallback that fired for this turn (worker metadata
   * passthrough) — the footer announces the swap, never silent.
   */
  quotaFallback?: {
    fromModel: string;
    category: QuotaFallbackCategoryValue;
  };
  /**
   * Set when the z.ai free-tier piggyback admission denied this guest request
   * (worker metadata passthrough) — renders one footer subtext line naming the
   * skipped piggyback model; the deny reason itself never reaches the client.
   */
  piggybackSkipped?: boolean;
  /** The denied piggyback model id, meaningful only alongside `piggybackSkipped`. */
  piggybackModel?: string;
  /**
   * The model id the provider reported serving. Populated on essentially
   * every response, not only routed ones — it differs from the requested
   * model both when a router alias genuinely resolved and when the provider
   * echoes a cosmetically different spelling of the same directly-requested
   * model, so mere inequality is not evidence of routing. Absent only when
   * the response carried no reported model id at all.
   */
  routedModel?: string;
  /** Whether response was generated in guest mode (free model, no API key) */
  isGuestMode?: boolean;
  /** Whether this is an auto-response from channel activation (not @mention) */
  isAutoResponse?: boolean;
  /** Whether fresh mode was active (LTM retrieval skipped; memories kept) */
  freshModeEnabled?: boolean;
  /** Whether incognito mode was active (LTM storage skipped) */
  incognitoModeActive?: boolean;
  /** Whether to show the model indicator footer (from config cascade) */
  showModelFooter?: boolean;
  /**
   * Bot-owner-visible TTS dispatch notices (e.g., "Mistral skipped because
   * reference audio >30s"). Surfaced as a `-#` subtext only when the user
   * receiving the response IS the bot owner; silent for everyone else (the
   * audio still plays via fallback, no UX disruption for normal users).
   */
  ttsNotices?: string[];
  /**
   * Discord user ID of the user this response is being sent to. Required to
   * gate `ttsNotices` rendering on `isBotOwner(recipientUserId)`. Optional
   * because not every caller surfaces notices, but if `ttsNotices` is set
   * without `recipientUserId`, the notices are silently dropped (fail-closed).
   */
  recipientUserId?: string;
}

/**
 * TTS dispatch notices (e.g., "Mistral skipped because reference audio >30s")
 * are bot-owner-visible only — silent for everyone else so a personality with
 * a too-long voice ref doesn't leak diagnostic noise to its users. The audio
 * still plays via fallback regardless of who's receiving the response.
 */
function buildOwnerOnlyTtsNoticeLines(options: ResponseFooterOptions): string {
  const { ttsNotices, recipientUserId } = options;
  if (
    ttsNotices === undefined ||
    ttsNotices.length === 0 ||
    recipientUserId === undefined ||
    !isBotOwner(recipientUserId)
  ) {
    return '';
  }
  // Escape markdown because the notice embeds user-controllable strings
  // (personality slug). Bot-owner-only scope keeps the impact cosmetic, but
  // an unescaped `]` or `(` could break the embedded `-# ⚠️` rendering.
  return ttsNotices.map(notice => `\n-# ⚠️ ${escapeMarkdown(notice)}`).join('');
}

/** Build the footer string from response options (model indicator, mode badges) */
export function buildResponseFooter(options: ResponseFooterOptions): string {
  const {
    modelUsed,
    providerUsed,
    fallbackProviderAttempted,
    fallbackFromProvider,
    fallthroughTriggered,
    quotaFallback,
    piggybackSkipped,
    piggybackModel,
    routedModel,
    isGuestMode,
    isAutoResponse,
    freshModeEnabled,
    incognitoModeActive,
    showModelFooter,
  } = options;
  let footer = '';
  if (showModelFooter !== false && modelUsed !== undefined && modelUsed.length > 0) {
    const modelUrl = buildModelInfoUrl(modelUsed, providerUsed);
    footer += `\n-# ${buildModelFooterText(modelUsed, modelUrl, {
      provider: providerUsed,
      fallbackProviderAttempted,
      fallbackFromProvider,
      fallthroughTriggered,
      quotaFallback,
      withAutoBadge: isAutoResponse === true,
      routedModel,
      routedModelUrl:
        routedModel !== undefined && routedModel.length > 0
          ? buildModelInfoUrl(routedModel, providerUsed)
          : undefined,
    })}`;
  } else if (isAutoResponse === true) {
    footer += `\n-# ${BOT_FOOTER_TEXT.AUTO_RESPONSE}`;
  }
  // Outside the model-footer gate, like the guest notices: a guest who hid
  // the model line still needs to know why a fallback model answered.
  if (piggybackSkipped === true && typeof piggybackModel === 'string') {
    footer += buildPiggybackNoteLine(piggybackModel);
  }
  if (isGuestMode === true) {
    footer += `\n-# ${GUEST_MODE.FOOTER_MESSAGE}`;
  }
  if (freshModeEnabled === true) {
    footer += `\n-# ${BOT_FOOTER_TEXT.FRESH_MODE}`;
  }
  if (incognitoModeActive === true) {
    footer += `\n-# ${BOT_FOOTER_TEXT.INCOGNITO_MODE}`;
  }
  footer += buildOwnerOnlyTtsNoticeLines(options);
  return footer;
}
