// One-off diagnostic. Delete after the PR #895 dev deploy validates that the
// new `reasoningDebug.upstreamProvider` capture works end-to-end — once that
// data flows into `/inspect`, the diagnostic JSON becomes self-segmenting and
// this script's purpose is served. Tracked in BACKLOG.md (Quick Wins) for
// removal in the next session post-deploy.
//
// Per .claude/rules/05-tooling.md, persistent diagnostic tooling lives in
// packages/tooling/. This file does NOT meet that bar — it is one-off
// investigation infrastructure for the OpenRouter reasoning extraction bug.
//
// Segment GLM-4.7 reasoning success/failure by upstream provider and other
// discriminators visible in the diagnostic JSON. Originally surfaced the ~11%
// of requests where `<reasoning>` tags didn't end up in rawContent.

import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';

interface DiagnosticRow {
  request_id: string;
  created_at: Date;
  model: string;
  provider: string;
  has_tags: boolean | null;
  upstream_provider: string | null;
  has_reasoning_details: boolean | null;
  raw_content_preview: string | null;
  additional_kwargs_keys: string[] | null;
  response_metadata_keys: string[] | null;
  reasoning_kwargs_length: number | null;
  finish_reason: string | null;
  duration_ms: number;
}

async function main(): Promise<void> {
  const prisma = getPrismaClient();
  try {
    // Last 24h of reasoning-capable requests on any GLM model.
    // Reads the post-PR-#895 `reasoningDebug.upstreamProvider` field, which
    // captures the actual upstream OpenRouter provider (Parasail/Chutes/etc.).
    // The pre-PR `responseMetadata.model_provider` field is hardcoded to
    // "openai" by LangChain regardless of upstream — useless for segmentation.
    const rows = await prisma.$queryRaw<DiagnosticRow[]>`
      SELECT
        request_id,
        created_at,
        model,
        provider,
        (data->'llmResponse'->'reasoningDebug'->>'hasReasoningTagsInContent')::boolean AS has_tags,
        data->'llmResponse'->'reasoningDebug'->>'upstreamProvider'                     AS upstream_provider,
        (data->'llmResponse'->'reasoningDebug'->>'hasReasoningDetails')::boolean       AS has_reasoning_details,
        data->'llmResponse'->'reasoningDebug'->>'rawContentPreview'                    AS raw_content_preview,
        (data->'llmResponse'->'reasoningDebug'->'additionalKwargsKeys')                AS additional_kwargs_keys,
        (data->'llmResponse'->'reasoningDebug'->'responseMetadataKeys')                AS response_metadata_keys,
        (data->'llmResponse'->'reasoningDebug'->>'reasoningKwargsLength')::int         AS reasoning_kwargs_length,
        data->'llmResponse'->>'finishReason'                                           AS finish_reason,
        duration_ms
      FROM llm_diagnostic_logs
      WHERE created_at > NOW() - INTERVAL '24 hours'
        AND model LIKE 'z-ai/glm%'
        AND data->'llmConfig'->'allParams'->'reasoning'->>'enabled' = 'true'
      ORDER BY created_at DESC
    `;

    console.log(`\n=== Total GLM reasoning requests (24h): ${rows.length} ===\n`);

    if (rows.length === 0) {
      console.log('No rows found. Diagnostic logs may have aged out or no recent traffic.');
      return;
    }

    // Bucket by model
    const byModel = new Map<string, { total: number; success: number; failure: number }>();
    for (const r of rows) {
      const m = byModel.get(r.model) ?? { total: 0, success: 0, failure: 0 };
      m.total += 1;
      if (r.has_tags === true) m.success += 1;
      else m.failure += 1;
      byModel.set(r.model, m);
    }

    console.log('=== Success/failure by model ===');
    for (const [model, stats] of byModel.entries()) {
      const rate = ((stats.success / stats.total) * 100).toFixed(1);
      console.log(
        `  ${model.padEnd(30)}  ${stats.success}/${stats.total} = ${rate}% success  (failures: ${stats.failure})`
      );
    }

    // Bucket by upstream provider (from reasoningDebug.upstreamProvider)
    const byProvider = new Map<string, { total: number; success: number; failure: number }>();
    for (const r of rows) {
      const p = r.upstream_provider ?? 'UNKNOWN';
      const m = byProvider.get(p) ?? { total: 0, success: 0, failure: 0 };
      m.total += 1;
      if (r.has_tags === true) m.success += 1;
      else m.failure += 1;
      byProvider.set(p, m);
    }

    console.log('\n=== Success/failure by upstream provider (reasoningDebug.upstreamProvider) ===');
    const providerEntries = Array.from(byProvider.entries()).sort(
      ([, a], [, b]) => b.total - a.total
    );
    for (const [provider, stats] of providerEntries) {
      const rate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) : '–';
      console.log(
        `  ${provider.padEnd(25)}  ${stats.success}/${stats.total} = ${rate}% success  (failures: ${stats.failure})`
      );
    }

    // Cross-tab: model x provider
    console.log('\n=== Cross-tab: model × provider × outcome ===');
    const cross = new Map<string, { success: number; failure: number }>();
    for (const r of rows) {
      const key = `${r.model} | ${r.upstream_provider ?? 'UNKNOWN'}`;
      const m = cross.get(key) ?? { success: 0, failure: 0 };
      if (r.has_tags === true) m.success += 1;
      else m.failure += 1;
      cross.set(key, m);
    }
    const crossEntries = Array.from(cross.entries()).sort(
      ([, a], [, b]) => b.success + b.failure - (a.success + a.failure)
    );
    for (const [key, stats] of crossEntries) {
      const total = stats.success + stats.failure;
      const rate = ((stats.success / total) * 100).toFixed(1);
      console.log(`  ${key.padEnd(50)}  ${stats.success}/${total} = ${rate}%`);
    }

    // List the failure cases — are they distinctive in any visible way?
    const failures = rows.filter(r => r.has_tags === false);
    console.log(`\n=== ${failures.length} failure cases ===`);
    for (const f of failures) {
      console.log(`\n  requestId: ${f.request_id}`);
      console.log(`  model:                 ${f.model}`);
      console.log(`  upstream provider:     ${f.upstream_provider ?? 'UNKNOWN'}`);
      console.log(`  finishReason:          ${f.finish_reason}`);
      console.log(`  hasReasoningDetails:   ${f.has_reasoning_details}`);
      console.log(`  reasoningKwargsLength: ${f.reasoning_kwargs_length}`);
      console.log(`  additionalKwargsKeys:  ${JSON.stringify(f.additional_kwargs_keys)}`);
      console.log(`  responseMetadataKeys:  ${JSON.stringify(f.response_metadata_keys)}`);
      console.log(`  durationMs:            ${f.duration_ms}`);
      console.log(
        `  rawContentPreview:     ${(f.raw_content_preview ?? '').substring(0, 150).replace(/\n/g, '\\n')}`
      );
    }

    // For comparison: a few success cases at random from the same model
    const glm47Successes = rows.filter(r => r.model === 'z-ai/glm-4.7' && r.has_tags === true);
    const sampleSuccesses = glm47Successes.slice(0, Math.min(3, glm47Successes.length));
    console.log(
      `\n=== ${sampleSuccesses.length} sample success cases (z-ai/glm-4.7) for comparison ===`
    );
    for (const s of sampleSuccesses) {
      console.log(`\n  requestId: ${s.request_id}`);
      console.log(`  upstream provider:     ${s.upstream_provider ?? 'UNKNOWN'}`);
      console.log(`  hasReasoningDetails:   ${s.has_reasoning_details}`);
      console.log(`  responseMetadataKeys:  ${JSON.stringify(s.response_metadata_keys)}`);
      console.log(
        `  rawContentPreview:     ${(s.raw_content_preview ?? '').substring(0, 100).replace(/\n/g, '\\n')}`
      );
    }
  } finally {
    await disconnectPrisma();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
