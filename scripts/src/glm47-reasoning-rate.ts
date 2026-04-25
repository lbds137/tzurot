import { getPrismaClient, disconnectPrisma } from '@tzurot/common-types';

const prisma = getPrismaClient();

interface Row {
  model: string;
  total: bigint;
  has_reasoning: bigint;
  reasoning_nonempty: bigint;
  pct_with_reasoning: number | null;
  oldest: Date;
  newest: Date;
}

async function main() {
  // Use `hasReasoningTagsInContent` as the meaningful metric: our OpenRouterFetch
  // interceptor strips reasoning out of LangChain kwargs and injects it into
  // content as <reasoning> tags. So "tags in content" = reasoning was returned
  // by the API and successfully extracted. "no tags" = either the API didn't
  // return reasoning, OR our interceptor failed to detect it.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT
      model,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE (data->'llmResponse'->'reasoningDebug'->>'hasReasoningTagsInContent')::boolean = true) as has_reasoning,
      COUNT(*) FILTER (WHERE (data->'llmResponse'->'reasoningDebug'->>'hasReasoningTagsInContent')::boolean = true) as reasoning_nonempty,
      ROUND(100.0 * COUNT(*) FILTER (WHERE (data->'llmResponse'->'reasoningDebug'->>'hasReasoningTagsInContent')::boolean = true) / NULLIF(COUNT(*), 0), 1) as pct_with_reasoning,
      MIN(created_at) as oldest,
      MAX(created_at) as newest
    FROM llm_diagnostic_logs
    WHERE created_at > NOW() - INTERVAL '14 days'
    GROUP BY model
    HAVING COUNT(*) >= 3
    ORDER BY total DESC
  `;

  console.log('\n=== GLM-family reasoning-channel hit rate (last 14 days, prod) ===\n');
  for (const r of rows) {
    const total = Number(r.total);
    const hasReasoning = Number(r.has_reasoning);
    const nonEmpty = Number(r.reasoning_nonempty);
    console.log(`Model: ${r.model}`);
    console.log(`  total requests:           ${total}`);
    console.log(
      `  hasReasoningInKwargs:     ${hasReasoning} (${((hasReasoning / total) * 100).toFixed(1)}%)`
    );
    console.log(
      `  reasoning length > 0:     ${nonEmpty} (${((nonEmpty / total) * 100).toFixed(1)}%)`
    );
    console.log(`  oldest:                   ${r.oldest.toISOString()}`);
    console.log(`  newest:                   ${r.newest.toISOString()}`);
    console.log('');
  }

  // Daily breakdown for GLM-4.7 specifically (to detect recent regression)
  const daily = await prisma.$queryRaw<{ day: Date; total: bigint; non_empty: bigint }[]>`
    SELECT
      date_trunc('day', created_at) as day,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE (data->'llmResponse'->'reasoningDebug'->>'hasReasoningTagsInContent')::boolean = true) as non_empty
    FROM llm_diagnostic_logs
    WHERE model = 'z-ai/glm-4.7'
      AND created_at > NOW() - INTERVAL '14 days'
    GROUP BY day
    ORDER BY day DESC
  `;

  console.log('\n=== GLM-4.7 daily reasoning-channel hit rate (last 14 days, prod) ===\n');
  for (const d of daily) {
    const total = Number(d.total);
    const nonEmpty = Number(d.non_empty);
    const pct = total > 0 ? ((nonEmpty / total) * 100).toFixed(1) : 'n/a';
    console.log(`${d.day.toISOString().slice(0, 10)}:  ${nonEmpty}/${total} (${pct}%)`);
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => disconnectPrisma());
