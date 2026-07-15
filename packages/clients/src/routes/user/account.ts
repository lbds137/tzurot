/**
 * User-audience account data-rights routes.
 *
 * Full-account export (data portability). The export START handler requires
 * BullMQ (aiQueue in RouteDeps) and short-circuits 503 without it. The
 * delete-account routes land beside these when the erasure feature ships.
 */

import { GATEWAY_TIMEOUTS } from '@tzurot/common-types/constants/discord';
import {
  StartAccountExportInputSchema,
  StartAccountExportResponseSchema,
  AccountExportStatusResponseSchema,
  AccountDeletePreviewResponseSchema,
  IssueAccountDeleteTokenSchema,
  IssueAccountDeleteTokenResponseSchema,
  DeleteAccountSchema,
  DeleteAccountResponseSchema,
} from '@tzurot/common-types/schemas/api/account';
import type { RouteDef } from '../types.js';

const BASE = '/account';

export const userAccountRoutes = {
  /**
   * Start a full-account export job. One active job per user (409 while
   * pending/in_progress); a completed/failed job is replaced on re-run.
   */
  startAccountExport: {
    audience: 'user',
    method: 'post',
    path: `${BASE}/export`,
    id: 'startAccountExport',
    input: StartAccountExportInputSchema,
    output: StartAccountExportResponseSchema,
    requiresProvisionedUser: true,
  },

  /** Latest account export job (null if never exported). */
  getAccountExportStatus: {
    audience: 'user',
    method: 'get',
    path: `${BASE}/export/status`,
    id: 'getAccountExportStatus',
    output: AccountExportStatusResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
    // No timeoutMs: GET defaults to DEFERRED — this is a local DB job-status
    // read, same posture as listShapesExportJobs.
  },

  /** Deletion impact preview: counts, per-character blast radius, phrase. */
  previewAccountDelete: {
    audience: 'user',
    method: 'get',
    path: `${BASE}/delete/preview`,
    id: 'previewAccountDelete',
    output: AccountDeletePreviewResponseSchema,
    requiresProvisionedUser: true,
    meta: { safeRead: true },
  },

  /** Exchange the typed confirmation phrase for a single-use delete token. */
  issueAccountDeleteToken: {
    audience: 'user',
    method: 'post',
    path: `${BASE}/delete/token`,
    id: 'issueAccountDeleteToken',
    input: IssueAccountDeleteTokenSchema,
    output: IssueAccountDeleteTokenResponseSchema,
    requiresProvisionedUser: true,
  },

  /** Erase the account. Synchronous single-transaction deletion. */
  deleteAccount: {
    audience: 'user',
    method: 'post',
    path: `${BASE}/delete`,
    id: 'deleteAccount',
    input: DeleteAccountSchema,
    output: DeleteAccountResponseSchema,
    requiresProvisionedUser: true,
    // The client must OUTWAIT the server: the deletion transaction has its
    // own 60s budget and the gateway sets no server-side timeout, so a
    // shorter client abort here shows a false failure while the deletion
    // commits anyway — unrecoverable UX with a single-use token (the same
    // class LONG_SYNC's own comment documents for db-sync).
    timeoutMs: GATEWAY_TIMEOUTS.LONG_SYNC,
    // At-most-once: deleteToken is single-use; a retried body yields a 4xx
    // even though the deletion succeeded. Never auto-retry.
    meta: { atMostOnce: true },
  },
} as const satisfies Record<string, RouteDef>;
