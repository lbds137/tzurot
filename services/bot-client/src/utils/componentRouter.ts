/**
 * Declarative component-interaction router.
 *
 * Commands with multiple interactive surfaces (browse, dashboard, destructive
 * confirms, detail views) previously hand-rolled the same try-prefix-A →
 * try-prefix-B → fallback dispatch chain in each command's handleButton/
 * handleSelectMenu/handleModal. This primitive turns that chain into a table:
 *
 * ```ts
 * const router = createComponentRouter({
 *   routes: [
 *     { matches: isBrowsePagination, onButton: handleBrowsePagination },
 *     { matches: DestructiveCustomIds.isDestructive, onButton: ..., onModal: ... },
 *   ],
 *   unrouted: async interaction => { ... }, // optional per-command fallback
 * });
 * export default defineCommand({ ...router });
 * ```
 *
 * Dispatch semantics:
 * - Routes are evaluated IN ORDER; the first route whose `matches(customId)`
 *   is true AND which declares a handler for the interaction kind wins.
 * - A route that matches but lacks the kind's handler is SKIPPED (its
 *   predicate may legitimately cover only buttons, not modals).
 * - No route claiming the interaction invokes `unrouted` when provided,
 *   else logs a warn. The router adds NO error handling around handlers —
 *   ack discipline and failure handling stay with the handlers themselves.
 */

import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('component-router');

/** One dispatch table entry. Declare only the interaction kinds the surface handles. */
export interface ComponentRoute {
  /** Claim predicate over the interaction's customId. */
  matches: (customId: string) => boolean;
  onButton?: (interaction: ButtonInteraction) => Promise<void>;
  onSelect?: (interaction: StringSelectMenuInteraction) => Promise<void>;
  onModal?: (interaction: ModalSubmitInteraction) => Promise<void>;
}

/** Any of the three component-interaction kinds the router dispatches. */
type RoutableInteraction = ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

/** The interaction kind being dispatched, passed to the unrouted fallback. */
export type ComponentKind = 'button' | 'select' | 'modal';

export interface ComponentRouterOptions {
  /** Ordered dispatch table. */
  routes: ComponentRoute[];
  /**
   * Called when no route claims the interaction. Optional — without it the
   * router logs a warn and returns (an unrouted modal then surfaces as
   * Discord's "This interaction failed", so commands whose modals can go
   * unrouted should provide one that acks with an error reply).
   */
  unrouted?: (interaction: RoutableInteraction, kind: ComponentKind) => Promise<void>;
}

export interface ComponentRouter {
  handleButton: (interaction: ButtonInteraction) => Promise<void>;
  handleSelectMenu: (interaction: StringSelectMenuInteraction) => Promise<void>;
  handleModal: (interaction: ModalSubmitInteraction) => Promise<void>;
}

/** Build the three CommandHandler-facing handlers from a dispatch table. */
export function createComponentRouter(options: ComponentRouterOptions): ComponentRouter {
  const { routes, unrouted } = options;

  async function dispatch(
    interaction: RoutableInteraction,
    kind: ComponentKind,
    pick: (route: ComponentRoute) => ((interaction: never) => Promise<void>) | undefined
  ): Promise<void> {
    for (const route of routes) {
      const handler = pick(route);
      if (handler !== undefined && route.matches(interaction.customId)) {
        await (handler as (interaction: RoutableInteraction) => Promise<void>)(interaction);
        return;
      }
    }
    if (unrouted !== undefined) {
      await unrouted(interaction, kind);
      return;
    }
    logger.warn({ customId: interaction.customId, kind }, 'Unrouted component interaction');
  }

  return {
    handleButton: interaction => dispatch(interaction, 'button', route => route.onButton),
    handleSelectMenu: interaction => dispatch(interaction, 'select', route => route.onSelect),
    handleModal: interaction => dispatch(interaction, 'modal', route => route.onModal),
  };
}
