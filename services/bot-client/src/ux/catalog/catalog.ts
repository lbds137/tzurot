/**
 * The message catalog — one intent-keyed vocabulary for user-facing strings.
 *
 * Canonical wording decisions live HERE (design §4.2), not at call sites:
 * - not-found → one shape; autocomplete hint where autocomplete exists.
 * - user-error retry → "Please try again." · infra-transient → "Please try
 *   again later."
 * - outcome-uncertain / committed-unconfirmed writes NEVER render a retry
 *   invitation — they render the verify-first shapes.
 *
 * Emoji are renderer-owned; text here is pre-emoji. For error classification
 * of caught gateway failures, do NOT hand-pick an intent — pass the error to
 * `classifyGatewayFailure` (catalog/classify.ts) and render its spec.
 */

import type { MessageSpec } from './types.js';

/** Options for the not-found shape. */
export interface NotFoundOptions {
  /** Append the autocomplete steer (only where the option HAS autocomplete). */
  autocomplete?: boolean;
  /** Name the specific entity instance: `Character "Luna" not found.` */
  name?: string;
  /** Contextual recovery steer appended after the absence statement. */
  hint?: string;
}

export const CATALOG = {
  error: {
    /** One not-found shape for every entity. */
    notFound: (entity: string, opts: NotFoundOptions = {}): MessageSpec => ({
      severity: 'error',
      outcome: 'failed',
      text:
        `${entity}${opts.name !== undefined ? ` "${opts.name}"` : ''} not found.` +
        `${opts.autocomplete === true ? ' Use autocomplete to select a valid option.' : ''}` +
        `${opts.hint !== undefined ? ` ${opts.hint}` : ''}`,
    }),

    /** The user's input was the problem; an immediate retry is honest. */
    userRetryable: (what: string): MessageSpec => ({
      severity: 'error',
      outcome: 'failed',
      text: `${what} Please try again.`,
    }),

    /** Infrastructure hiccup; retry later is honest. */
    transient: (what: string): MessageSpec => ({
      severity: 'warning',
      outcome: 'failed',
      text: `${what} Please try again later.`,
    }),

    /**
     * A write whose outcome is UNKNOWN (timeout/network mid-flight). Never
     * invites a retry — the write may have applied (duplicate-write risk).
     * `refreshAffordance` names the dashboard 🔄 Refresh button where one
     * exists; the generic form steers to verify by re-checking.
     */
    uncertainWrite: (
      resource: string,
      opts: { refreshAffordance?: boolean } = {}
    ): MessageSpec => ({
      severity: 'progress',
      outcome: 'uncertain',
      text:
        `This is taking longer than usual — your ${resource} change may still be applying. ` +
        (opts.refreshAffordance === true
          ? 'Give it a moment, then tap **🔄 Refresh** to confirm before saving again.'
          : 'Give it a moment and check the current state — no need to resend it yet.'),
    }),

    /** The write applied; only the confirmation read-back failed. */
    committedUnconfirmed: (
      resource: string,
      opts: { refreshAffordance?: boolean } = {}
    ): MessageSpec => ({
      severity: 'success',
      outcome: 'committed-unconfirmed',
      text:
        `Your ${resource} change was saved, but I couldn't read the confirmation back. ` +
        (opts.refreshAffordance === true
          ? 'Tap **🔄 Refresh** to verify — no need to save again.'
          : 'It should be in effect — no need to save again.'),
    }),

    /**
     * A definitive gateway rejection whose own message is worth surfacing
     * (validation detail, conflict explanation). The gateway emits clean
     * user-appropriate JSON messages (arch rule); bot-client adds the emoji.
     */
    gatewayRejection: (gatewayMessage: string): MessageSpec => ({
      severity: 'error',
      outcome: 'failed',
      text: gatewayMessage,
    }),

    /** Generic definitive failure when nothing better is known. */
    operationFailed: (action: string): MessageSpec => ({
      severity: 'error',
      outcome: 'failed',
      text: `Failed to ${action}. Please try again.`,
    }),

    /** Policy/permission denial — ALWAYS system voice (design §4.3). */
    permissionDenied: (action: string): MessageSpec => ({
      severity: 'error',
      outcome: 'failed',
      text: `You do not have permission to ${action}.`,
    }),

    /** Input validation failure (pre-gateway). */
    validation: (detail: string): MessageSpec => ({
      severity: 'error',
      outcome: 'failed',
      text: detail,
    }),

    /** Top-level command dispatch failure (CommandHandler catch-all). */
    commandFailed: (): MessageSpec => ({
      severity: 'error',
      outcome: 'failed',
      text: 'There was an error executing this command!',
    }),

    /** Component/modal dispatch failure (CommandHandler catch-all). */
    interactionFailed: (): MessageSpec => ({
      severity: 'error',
      outcome: 'failed',
      text: 'There was an error processing this interaction!',
    }),
  },

  success: {
    /** Post-action banner: `✅ **{Verb}** · {name}` after rendering. */
    banner: (verb: string, entityName: string): MessageSpec => ({
      severity: 'success',
      outcome: 'ok',
      text: `**${verb}** · ${entityName}`,
    }),

    done: (what: string): MessageSpec => ({
      severity: 'success',
      outcome: 'ok',
      text: what,
    }),
  },

  progress: {
    working: (action: string): MessageSpec => ({
      severity: 'progress',
      outcome: 'none',
      icon: 'loading',
      text: `${action}...`,
    }),

    sessionExpired: (command?: string): MessageSpec => ({
      severity: 'warning',
      outcome: 'none',
      icon: 'session-expiry',
      text:
        command !== undefined && command.length > 0
          ? `Session expired. Please run \`${command}\` again.`
          : 'Session expired. Please run the command again.',
    }),
  },

  info: {
    note: (text: string): MessageSpec => ({
      severity: 'info',
      outcome: 'none',
      text,
    }),
  },
} as const;
