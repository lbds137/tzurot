/**
 * Schema Audit Configuration
 *
 * Suppresses findings from `pnpm ops dev:schema-audit` that represent
 * intentional design rather than fake-optionality bugs. Suppression keys
 * are schema-qualified strings (`Model.fieldName`) validated against the
 * parsed Prisma schema at audit startup. Stale keys fail loudly — never
 * silently no-op on a renamed/removed/tightened column.
 *
 * See `docs/reference/tooling/schema-audit.md` for the four canonical
 * patterns (state machine / default-fallback / deferred-set / state-machine-by-status).
 * If you're adding a suppression here, the corresponding triple-slash
 * doc on the schema field should explain the pattern in domain terms.
 */

import type { SchemaAuditConfig } from './packages/tooling/src/dev/schema-audit-suppression.js';

export const schemaAuditConfig: SchemaAuditConfig = {
  suppressions: [
    {
      key: 'UserPersonalityConfig.configOverrides',
      reason:
        'orthogonal-aggregation: row encodes multiple independent overrides (llmConfigId, ttsConfigId, personaId, configOverrides JSON) and each upsert site sets one slice. Different upsert routes (model-override, tts-override, persona/override) legitimately omit configOverrides; the config-overrides + memory routes pass it. Not the caller-identity-encoded bug shape — the row aggregation is intentional.',
      reviewedAt: '2026-05-21',
    },
  ],
};
