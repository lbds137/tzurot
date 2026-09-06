/**
 * Markdown rendering for the render-pilot aggregate report (`summary.md`) and
 * the LOCAL-ONLY per-slug spot-check file. Split out of `render-pilot-metrics.ts`
 * to keep that file under its line budget.
 *
 * The aggregate report renderer contains NO memory text and NO reply text —
 * every value it prints comes off `ReportJson`, which `buildReportJson`
 * (in render-pilot-metrics.ts) builds from numeric/boolean fields only. The
 * spot-check renderer is the opposite by design: LOCAL-ONLY, carrying
 * verbatim text for a human review pass.
 */

import type { RenderArm } from './render-pilot-render.js';
import type {
  ArmAnswerStats,
  SummaryArmStats,
  FactsArmStats,
  VoiceArmStats,
  UsageStat,
  ReportJson,
} from './render-pilot-report-types.js';

const ARMS: RenderArm[] = ['V', 'F', 'S'];

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** The per-arm answer-correctness table shared by the pooled and per-character sections. */
function armsTableMarkdown(arms: Record<RenderArm, ArmAnswerStats>): string {
  const header =
    '| Arm | n | Unjudged | Correctness | Correctness (assistant) | Correctness (user) | Unfaithful rate | Unsupported claims (mean) | Tail tokens mean/p95 | Truncated | Summary fallback rows (mean) |';
  const divider = '|---|---|---|---|---|---|---|---|---|---|---|';
  const rows = ARMS.map(arm => {
    const s = arms[arm];
    return `| ${arm} | ${String(s.n)} | ${String(s.unjudged)} | ${pct(s.correctnessRate)} | ${pct(s.correctnessByBasis.assistant)} | ${pct(s.correctnessByBasis.user)} | ${pct(s.unfaithfulRate)} | ${num(s.unsupportedClaimsMean)} | ${num(s.tokensInTail.mean)} / ${num(s.tokensInTail.p95)} | ${pct(s.truncatedRate)} | ${num(s.summaryFallbackRowsMean)} |`;
  });
  return [header, divider, ...rows].join('\n');
}

function summaryArmMarkdown(s: SummaryArmStats): string {
  return [
    '**Arm S (summaries)**',
    '',
    `- n: ${String(s.n)} (unjudged: ${String(s.unjudged)})`,
    `- Faithful rate: ${pct(s.faithfulRate)}`,
    `- Dangling-reference rate (over referenced rows): ${pct(s.danglingReferenceRateOverReferenced)}`,
    `- Dangling-reference rate (over all rows): ${pct(s.danglingReferenceRateOverAll)}`,
    `- Missing-commitment rate: ${pct(s.missingCommitmentRate)}`,
    `- State distribution: within_soft=${String(s.stateDistribution.within_soft)}, regenerated=${String(s.stateDistribution.regenerated)}, overflow=${String(s.stateDistribution.overflow)}`,
    `- First-person rate: ${pct(s.firstPersonRate)}`,
    `- Tokens mean/p95: ${num(s.tokens.mean)} / ${num(s.tokens.p95)}`,
    `- Parse-failed count: ${String(s.parseFailedCount)}`,
  ].join('\n');
}

function factsArmMarkdown(f: FactsArmStats): string {
  return [
    '**Arm F (linked facts)**',
    '',
    `- n: ${String(f.n)}`,
    `- Rows without facts: ${pct(f.rowsWithoutFactsShare)}`,
    `- Missing-commitment rate: ${pct(f.missingCommitmentRate)}`,
  ].join('\n');
}

function voiceTableMarkdown(voice: Record<RenderArm, VoiceArmStats>): string {
  const header =
    '| Arm | n | Chars (mean) | Words (mean) | Exclamations/100w (mean) | Emoji (mean) | Self-reference rate | Marker hits (mean) | Truncated | Summary fallback rows (mean) |';
  const divider = '|---|---|---|---|---|---|---|---|---|---|';
  const rows = ARMS.map(arm => {
    const v = voice[arm];
    return `| ${arm} | ${String(v.n)} | ${num(v.charsMean)} | ${num(v.wordsMean)} | ${num(v.exclamationsPer100WordsMean)} | ${num(v.emojiCountMean)} | ${pct(v.selfReferenceRate)} | ${num(v.markerHitsMean)} | ${pct(v.truncatedRate)} | ${num(v.summaryFallbackRowsMean)} |`;
  });
  return [header, divider, ...rows].join('\n');
}

/** Counts only, per `ReportJson.callFailures`'s own no-error-text contract. */
function callFailuresLine(callFailures: Record<string, number>): string {
  const nonZero = Object.entries(callFailures).filter(([, count]) => count > 0);
  if (nonZero.length === 0) {
    return 'Failed model calls by stage: none';
  }
  const parts = nonZero.map(([stage, count]) => `${stage}=${String(count)}`);
  return `Failed model calls by stage: ${parts.join(', ')}`;
}

function usageTableMarkdown(usage: UsageStat[]): string {
  if (usage.length === 0) {
    return '_(no usage recorded)_';
  }
  const header =
    '| Stage | Model | Calls | Prompt tokens | Completion tokens | Reasoning blocks stripped |';
  const divider = '|---|---|---|---|---|---|';
  const rows = usage.map(
    u =>
      `| ${u.stage} | ${u.model} | ${String(u.calls)} | ${String(u.promptTokens)} | ${String(u.completionTokens)} | ${String(u.reasoningBlocksStripped)} |`
  );
  return [header, divider, ...rows].join('\n');
}

/** Render one character/pooled report section as markdown. */
export function buildReportSectionMarkdown(title: string, json: ReportJson): string {
  return [
    `## ${title}`,
    '',
    `Dropped malformed questions: ${String(json.droppedMalformedQuestions)}`,
    '',
    callFailuresLine(json.callFailures),
    '',
    '### Answers by arm',
    '',
    armsTableMarkdown(json.arms),
    '',
    '### Arm S / Arm F detail',
    '',
    summaryArmMarkdown(json.summaryArm),
    '',
    factsArmMarkdown(json.factsArm),
    '',
    '### Voice probe',
    '',
    `n = ${String(ARMS.reduce((sum, arm) => sum + json.voice[arm].n, 0))}`,
    '',
    voiceTableMarkdown(json.voice),
    '',
    '### Usage',
    '',
    usageTableMarkdown(json.usage),
    '',
  ].join('\n');
}

export interface PooledReport {
  perCharacter: Record<string, ReportJson>;
  pooled: ReportJson;
}

/** Render the full multi-character report: pooled section first, then one section per character. */
export function buildReportMarkdown(report: PooledReport): string {
  const sections = [
    '# Render Pilot Report',
    '',
    buildReportSectionMarkdown('Pooled (all characters)', report.pooled),
  ];
  for (const [slug, json] of Object.entries(report.perCharacter)) {
    sections.push(buildReportSectionMarkdown(`Character: ${slug}`, json));
  }
  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// Spot-check file — LOCAL-ONLY, carries verbatim text by design
// ---------------------------------------------------------------------------

export interface SpotCheckRow {
  id: string;
  createdAt: string;
  verbatim: string;
  renderF: string;
  renderS: string;
}

export function buildSpotCheckMarkdown(characterName: string, rows: SpotCheckRow[]): string {
  const header = [
    `# Spot check — ${characterName}`,
    '',
    'LOCAL-ONLY: this file may contain verbatim memory text. Never commit it.',
    '',
  ];
  const body = rows.flatMap(row => [
    `## ${row.id} (${row.createdAt})`,
    '',
    '**Verbatim**',
    '```',
    row.verbatim,
    '```',
    '',
    '**Arm F**',
    '```',
    row.renderF,
    '```',
    '',
    '**Arm S**',
    '```',
    row.renderS,
    '```',
    '',
  ]);
  return [...header, ...body].join('\n');
}
