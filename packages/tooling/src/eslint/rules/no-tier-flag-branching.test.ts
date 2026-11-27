import { RuleTester } from 'eslint';
import { describe, expect, it } from 'vitest';
import { noTierFlagBranching } from './no-tier-flag-branching.js';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

describe('no-tier-flag-branching', () => {
  it('exposes problem rule metadata and messageId', () => {
    expect(noTierFlagBranching.meta?.type).toBe('problem');
    expect(noTierFlagBranching.meta?.messages?.noTierFlagBranching).toContain('effectiveTier');
  });

  ruleTester.run('no-tier-flag-branching', noTierFlagBranching, {
    valid: [
      {
        // Allowlisted seam entry point
        filename: 'services/ai-worker/src/services/ProviderRouter.ts',
        code: 'if (isGuestMode) { useGuestRoute(); }',
      },
      {
        // Allowlisted auth step
        filename: 'services/ai-worker/src/jobs/handlers/pipeline/steps/AuthStep.ts',
        code: 'const flag = route.isGuestMode ? "guest" : "member";',
      },
      {
        // Test files are exempt
        filename: 'services/ai-worker/src/services/quotaFallback.test.ts',
        code: 'if (isGuestMode) { expect(true).toBe(true); }',
      },
      {
        // Passing isGuestMode as a value / property forwarding (not a conditional test)
        filename: 'services/ai-worker/src/jobs/handlers/pipeline/steps/GenerationStep.ts',
        code: 'const payload = { isGuestMode: auth.isGuestMode }; forwardAuth(auth.isGuestMode, payload);',
      },
      {
        // Nullish coalescing fallback is value plumbing, not boolean && / || branching
        filename: 'services/ai-worker/src/jobs/handlers/pipeline/steps/quotaFallbackRunner.ts',
        code: 'const flag = effectiveIsGuestMode ?? opts.isGuestMode;',
      },
      {
        // Branching on effectiveTier instead of isGuestMode
        filename: 'services/ai-worker/src/services/quotaFallback.ts',
        code: 'const floor = tier === "free" ? getFreeTextFloor() : getSystemSetting("fallbackTextModel");',
      },
    ],
    invalid: [
      {
        // Positive control: real tier floor branch in quotaFallback.ts
        filename: 'services/ai-worker/src/services/quotaFallback.ts',
        code: 'const floor = isGuestMode ? getFreeTextFloor() : getSystemSetting("fallbackTextModel");',
        errors: [{ messageId: 'noTierFlagBranching' }],
      },
      {
        // IfStatement.test (bare identifier)
        filename: 'services/ai-worker/src/services/quotaFallback.ts',
        code: 'if (isGuestMode) { selectFreeFloor(); }',
        errors: [{ messageId: 'noTierFlagBranching' }],
      },
      {
        // IfStatement.test (negated member expression)
        filename: 'services/ai-worker/src/jobs/handlers/pipeline/steps/hopOneFloorTarget.ts',
        code: 'if (!opts.isGuestMode) { usePaidFloor(); }',
        errors: [{ messageId: 'noTierFlagBranching' }],
      },
      {
        // ConditionalExpression.test (member expression)
        filename: 'services/ai-worker/src/jobs/handlers/pipeline/steps/hopOneFloorTarget.ts',
        code: 'const key = opts.isGuestMode ? SYSTEM_CACHE_KEY_ID : cacheKeyId;',
        errors: [{ messageId: 'noTierFlagBranching' }],
      },
      {
        // LogicalExpression.left with &&
        filename: 'services/ai-worker/src/jobs/handlers/pipeline/steps/quotaFallbackRunner.ts',
        code: 'const shouldThrottle = isGuestMode && isZaiProvider;',
        errors: [{ messageId: 'noTierFlagBranching' }],
      },
      {
        // LogicalExpression.left with ||
        filename: 'services/ai-worker/src/jobs/handlers/pipeline/steps/promotionDemotion.ts',
        code: 'const useSystem = auth.isGuestMode || forceSystemKey;',
        errors: [{ messageId: 'noTierFlagBranching' }],
      },
      {
        // SwitchCase.test
        filename: 'services/ai-worker/src/services/modelInvocation.ts',
        code: 'switch (true) { case opts.isGuestMode: break; default: break; }',
        errors: [{ messageId: 'noTierFlagBranching' }],
      },
    ],
  });
});
