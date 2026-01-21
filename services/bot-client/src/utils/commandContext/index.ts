/**
 * Command Context Module
 *
 * Provides type-safe command contexts that prevent InteractionAlreadyReplied errors
 * at compile time by exposing only the methods appropriate for each deferral mode.
 *
 * @example
 * // Import types and factories
 * import {
 *   type DeferredCommandContext,
 *   type ModalCommandContext,
 *   createDeferredContext,
 *   createModalContext,
 * } from './commandContext/index.js';
 */

export type {
  DeferralMode,
  DeferredCommandContext,
  ModalCommandContext,
  ManualCommandContext,
  SafeCommandContext,
} from './types.js';

export { createDeferredContext, createModalContext, createManualContext } from './factories.js';
