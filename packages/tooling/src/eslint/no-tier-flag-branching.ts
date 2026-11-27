import type { Rule } from 'eslint';

/**
 * Files in `services/ai-worker/src/` permitted to read `isGuestMode` in
 * conditional expressions (single-sourced here; `eslint.config.js` enables
 * `@tzurot/no-tier-flag-branching` across every .ts file under
 * services/ai-worker/src/ and delegates per-file exemptions to this list):
 * - Auth resolution & tier seam entry points (`ProviderRouter`, `postRouteLlmAuth`, `AuthStep`, `effectiveTier`)
 * - Non-tier UI / telemetry / audio-key plumbing (`AIJobProcessor`, `describeImageWithFallback`)
 * - Tier-keyed vision selection & cross-provider vision auth (`VisionProcessor`, `visionAuthResolver` — pipeline callers pass `effectiveTier === 'free'`, so degraded-to-system BYOK and `'none'` routes select free vision)
 *
 * Known syntactic limitation: aliasing (`const flag = opts.isGuestMode; if (flag) ...`
 * or destructuring to a renamed local) is not tracked and passes without
 * error; catching it would require scope/data-flow analysis beyond the AST
 * condition subtree walk.
 */
export const DEFAULT_TIER_FLAG_ALLOWLIST: readonly string[] = [
  'services/ai-worker/src/services/ProviderRouter.ts', // -- upstream route resolution produces isGuestMode before the effectiveTier seam runs
  'services/ai-worker/src/jobs/handlers/pipeline/steps/postRouteLlmAuth.ts', // -- seam translator: buildPostRouteLlmAuth and toResolvedAuth forward isGuestMode alongside source-derived KeyProvenance
  'services/ai-worker/src/jobs/handlers/pipeline/steps/AuthStep.ts', // -- audio-provider BYOK admission guard (!result.isGuestMode on ElevenLabs/Mistral lookups, independent of LLM tier)
  'services/ai-worker/src/services/effectiveTier.ts', // -- the effectiveTier seam module itself
  'services/ai-worker/src/jobs/AIJobProcessor.ts', // -- usage-row byok telemetry column derivation (deriveByok) and audio-job key guard, not model/floor tiering
  'services/ai-worker/src/services/multimodal/VisionProcessor.ts', // -- tier-keyed vision model selection (selectVisionModel) and error-message copy discriminator (deriveApiKeySource); pipeline callers pass effectiveTier === 'free'
  'services/ai-worker/src/services/multimodal/describeImageWithFallback.ts', // -- vision fallback walk receives effectiveTier === 'free' from pipeline callers and checks VisionConfig.isGuestMode for piggyback reactor
  'services/ai-worker/src/services/multimodal/visionAuthResolver.ts', // -- tier-keyed cross-provider vision auth resolution; pipeline callers pass effectiveTier === 'free' so degraded-to-system and keyless routes select free vision
];

interface AstNode {
  type: string;
  name?: string;
  operator?: string;
  computed?: boolean;
  test?: AstNode | null;
  left?: AstNode | null;
  right?: AstNode | null;
  discriminant?: AstNode | null;
  argument?: AstNode | null;
  object?: AstNode | null;
  property?: AstNode | null;
  key?: AstNode | null;
  value?: AstNode | null;
  expression?: AstNode | null;
  expressions?: AstNode[];
  elements?: (AstNode | null)[];
  properties?: AstNode[];
  arguments?: AstNode[];
  callee?: AstNode | null;
}

interface RuleOptions {
  allowlist?: string[];
}

const FUNCTION_BOUNDARY_TYPES = new Set([
  'ArrowFunctionExpression',
  'FunctionExpression',
  'FunctionDeclaration',
]);

function isExemptFile(rawFilename: string, allowlist: readonly string[]): boolean {
  const filename = rawFilename.replace(/\\/g, '/');
  if (
    filename.endsWith('.test.ts') ||
    filename.endsWith('.spec.ts') ||
    filename.endsWith('.mock.ts')
  ) {
    return true;
  }

  for (const allowed of allowlist) {
    if (filename === allowed || filename.endsWith(`/${allowed}`)) {
      return true;
    }
  }

  return false;
}

function getChildNodes(node: AstNode): AstNode[] {
  if (node.type === 'Property') {
    const children: AstNode[] = [];
    if (node.computed === true && node.key) {
      children.push(node.key);
    }
    if (node.value) {
      children.push(node.value);
    }
    return children;
  }

  if (node.type === 'MemberExpression') {
    const children: AstNode[] = [];
    if (node.object) {
      children.push(node.object);
    }
    if (node.property) {
      children.push(node.property);
    }
    return children;
  }

  const candidates: (AstNode | null | undefined)[] = [
    node.argument,
    node.left,
    node.right,
    node.test,
    node.expression,
    node.callee,
    ...(node.arguments ?? []),
    ...(node.expressions ?? []),
    ...(node.elements ?? []),
    ...(node.properties ?? []),
  ];

  return candidates.filter((child): child is AstNode => child !== null && child !== undefined);
}

function collectTierFlagReads(root: AstNode | null | undefined, found: AstNode[]): void {
  if (!root || FUNCTION_BOUNDARY_TYPES.has(root.type)) {
    return;
  }

  if (root.type === 'Identifier' && root.name === 'isGuestMode') {
    found.push(root);
    return;
  }

  for (const child of getChildNodes(root)) {
    collectTierFlagReads(child, found);
  }
}

export const noTierFlagBranching: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow conditional branching on isGuestMode outside the effectiveTier seam and allowlisted plumbing files.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowlist: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noTierFlagBranching:
        "Do not branch on 'isGuestMode' in consumer code. Branch on 'effectiveTier' (from resolveEffectiveTier) or derive cache keys via 'authCacheKeyId'.",
    },
  },
  create(context: Rule.RuleContext): Rule.RuleListener {
    const options = (context.options[0] as RuleOptions | undefined) ?? {};
    const allowlist = options.allowlist ?? DEFAULT_TIER_FLAG_ALLOWLIST;

    if (isExemptFile(context.filename, allowlist)) {
      return {};
    }

    const reported = new Set<AstNode>();

    function checkConditionSubtree(conditionNode: AstNode | null | undefined): void {
      const hits: AstNode[] = [];
      collectTierFlagReads(conditionNode, hits);
      for (const hit of hits) {
        if (!reported.has(hit)) {
          reported.add(hit);
          context.report({
            node: hit as unknown as Rule.Node,
            messageId: 'noTierFlagBranching',
          });
        }
      }
    }

    return {
      IfStatement(node: Rule.Node): void {
        checkConditionSubtree((node as unknown as AstNode).test);
      },
      ConditionalExpression(node: Rule.Node): void {
        checkConditionSubtree((node as unknown as AstNode).test);
      },
      LogicalExpression(node: Rule.Node): void {
        const astNode = node as unknown as AstNode;
        if (astNode.operator === '&&' || astNode.operator === '||') {
          checkConditionSubtree(astNode.left);
        }
      },
      SwitchCase(node: Rule.Node): void {
        checkConditionSubtree((node as unknown as AstNode).test);
      },
      SwitchStatement(node: Rule.Node): void {
        checkConditionSubtree((node as unknown as AstNode).discriminant);
      },
      WhileStatement(node: Rule.Node): void {
        checkConditionSubtree((node as unknown as AstNode).test);
      },
      DoWhileStatement(node: Rule.Node): void {
        checkConditionSubtree((node as unknown as AstNode).test);
      },
      ForStatement(node: Rule.Node): void {
        checkConditionSubtree((node as unknown as AstNode).test);
      },
    };
  },
};
