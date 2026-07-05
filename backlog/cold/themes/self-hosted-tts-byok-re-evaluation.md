### Theme: Self-Hosted TTS + BYOK Re-Evaluation (NeuTTS Air abandoned 2026-05-13)

_Focus: NeuTTS Air was the planned Phase 2 self-hosted voice-cloning engine but was abandoned after a hands-on probe revealed architectural mismatch. Need to evaluate replacement candidates AND reassess Mistral BYOK quality._

**NeuTTS Air abandon evidence (2026-05-13 probe + research)**:

- README spec: "Context Window: 2048 tokens, enough for processing ~30 seconds of audio" — hard cap incompatible with our 1-4 min long-form use case
- Hands-on Railway probe (Sapphire Rapids Xeon 8581C, 16 cores): RTF 12-21x on completed inferences; outputs truncate well below requested length
- GitHub issue [#41](https://github.com/neuphonic/neutts/issues/41): user on i9-9900K + RTX 2080 Ti reports RTF 4 — far worse than published "real-time" claims
- GitHub issue [#62](https://github.com/neuphonic/neutts/issues/62): open feature request for chunked long-form support, no maintainer response in 7 months
- GitHub issues [#15, #22](https://github.com/neuphonic/neutts/issues): output truncation reports, no maintainer responses
- Pattern: maintainer team essentially unresponsive on quality/performance issues

User feedback 2026-05-12: "Mistral still kinda sucks. after NeuTTS I may want to look into a better provider (again)."

User feedback 2026-05-13 (post-NeuTTS-abandon): both self-hosted (Pocket TTS) AND BYOK (Mistral) are below the quality bar. Pocket TTS has had at least one user complaint plus owner's own underwhelmed assessment. Tomorrow's priority: revisit BOTH tracks together — the goal isn't "find a NeuTTS replacement," it's "raise the quality floor on both self-hosted and BYOK paths."

**Update 2026-05-13 (exhaustive CPU probe completed)**: After hands-on probing of NeuTTS Air, XTTS v2, SoproTTS, MOSS-TTS-Nano, and ZipVoice (with desk research on F5-TTS, OmniVoice, CosyVoice), the conclusion is **CPU-only + voice-cloning + acceptable-quality is structurally unachievable** in current open source. Pocket TTS turns out to be the uniquely best CPU-cloning option, not by luck but by virtue of kyutai-labs's engineering maturity. The free-tier ceiling is therefore Pocket TTS as-is; meaningful self-hosted quality improvement would require GPU compute (separate decision — Modal/RunPod/Replicate for voice-engine).

**Update 2026-05-13 (Mistral guardrail evidence)**: Production logs revealed Mistral content-filtering innocuous humor (e.g., Monty Python references) with `code 1920 guardrail_violation`, silently degrading to self-hosted. Beyond a fix for visibility (see inbox), this is concrete evidence Mistral's content policy is too restrictive for our user base's irreverent personalities. Raises priority of BYOK re-eval.

**Pivot plan (next session)**: skip more CPU-engine probes; tackle the BYOK side directly. BYOK probes are fast (API calls, no install dances). **Step 0 — research pass first**: the candidate landscape is broader than the initial list captured here, and pricing has to be a primary filter (ElevenLabs was canceled 2026-05-08 specifically because it was too expensive — same constraint applies to candidate selection). Surface ALL viable BYOK voice-cloning options with current pricing, then probe the survivors.

**Candidates known (non-exhaustive):**

- **Cartesia Sonic** — low-latency, good cloning fidelity, less restrictive content policy
- **Fish Audio** — voice cloning, fast inference, competitive pricing (per user 2026-05-13)
- **PlayHT** — multiple model tiers, voice cloning
- **Resemble AI** — voice cloning, pricing unclear (verify)

**Hard out:**

- **ElevenLabs (any tier)** — per-character pricing too high; subscription canceled 2026-05-08

**Worth a research-pass scan** before bake-off:

- Rime.ai, Murf.ai, Sesame.AI (CSM), Deepgram TTS (newer), and any 2025–2026 entrants. Cloud TTS (Google/Azure/AWS) typically requires custom-voice training rather than zero-shot reference clips, so probably out unless our flow can absorb that.

Same probe pattern as self-hosted, but with API requests instead of local inference. Listen-test against the existing emily / lila / lilith reference + same test text for direct A/B with Mistral output. Pricing-per-1K-chars (or per-minute-of-output) needs to be in the comparison table alongside quality.

**Folded in from the deferred prune (2026-06-03):**

- **TTS Budget Guard decorator** — wrap the provider stack in a `BudgetTtsProvider` reading `MONTHLY_TTS_BUDGET_CENTS`; force-switch to free self-hosted once budget exceeded. Hard safety net for whatever BYOK provider wins the bake-off (originally scoped against Mistral cost, surfaced 2026-05-01 in Kimi K2.6 council review). Build it as part of this theme — it's a decision input for the provider commitment, not a standalone item.

**Required: Step 0 — hands-on probe before promoting any candidate to plan-mode** (lesson learned from NeuTTS Air decision-without-probe). The probe pattern that worked well: SSH dev voice-engine, install candidate in `/tmp` venv, run a 20-line bench script that loads model + synthesizes 5-30s of output + measures elapsed time + RAM peak. Total 30 min, no PR. Decision criteria: RTF < 3.0 OR (constant-time pattern that yields acceptable per-request synth time at the user's actual desired output lengths) AND subjectively-better-than-Pocket-TTS quality. The 2026-05-13 NeuTTS Air probe scripts are a reusable template.

**Candidates re-evaluated 2026-05-14** (council brainstorm via Gemini 3.1 Pro Preview, after dropping the Pocket TTS post-processing sub-track):

- **F5-TTS** — **DROPPED 2026-05-14 after hands-on probe**. License: code MIT, weights CC-BY-NC (OK for our non-commercial use). Council estimated vanilla CPU RTF ~1.5 reducible to ~0.5-0.8 via ONNX + step reduction + thread limiting. Probe results on Sapphire Rapids 8581C with `f5-tts` from PyPI:
  - **RTF 1.94** at NFE=4 / 32 threads (best speed config). User quality verdict: **"barely any audible word output. mostly weird hissing and artifacting"** — flow-matching diffusion didn't converge enough at NFE=4 to produce coherent speech.
  - **RTF 3.58** at NFE=8 / 32 threads (council's recommended speedup). Not user-tested at this NFE because the speed was already unworkable.
  - Council's thread-thrashing hypothesis was **falsified for this workload** — fewer threads made RTF monotonically WORSE (NFE=4 hit RTF 2.74 at 8 threads, 3.69 at 4 threads).

  **The structural problem**: at the NFE level F5-TTS needs to produce coherent output (≥8), CPU RTF is unworkable; at the NFE level CPU can sustain (4), the flow-matching diffusion collapses into hiss. There is no NFE setting where this works on CPU. ONNX optimization (DakeQQ port) might close 2-3x of speed but can't move the NFE quality cliff. Closed.

  **Reusable lesson — don't probe below the quality cliff "to see speed numbers"**: when reducing iteration count on diffusion or flow-matching models, there's a hard quality cliff below some threshold (~NFE=6-8 for most modern flow models, model-dependent) that's separate from the gradual degradation above it. Always test quality at the recommended NFE first, THEN ask whether the resulting speed is survivable. Going under the recommended NFE because the speed is unworkable is a category error — the speed is meaningless if the output isn't speech.

- **k2-fsa/OmniVoice** — **RULE OUT** (desk research only). Sherpa-ONNX makes it blazingly fast on CPU but the underlying VITS-based architecture has the same baked-in "machine-y" cadence as Pocket TTS. Lateral move on the actual user complaint, not improvement.
- **CosyVoice 2.0** (Alibaba) — **RULE OUT** (desk research only). CPU RTF >1.5-3.0 in community benchmarks, heavily CUDA-optimized. Would choke the Railway container without a complete inference rewrite (C++/ONNX), and even then it's heavy.

**Verdict 2026-05-14**: CPU-only voice cloning is **comprehensively, empirically exhausted** across seven distinct intervention angles. Eight engines tested (NeuTTS Air, XTTS v2, SoproTTS, MOSS-TTS-Nano, ZipVoice, OpenVoice V2 TCC, F5-TTS hands-on; OmniVoice and CosyVoice desk-research). Pocket TTS remains the local optimum, and on top of the engine-swap evidence we now have: (a) Pocket TTS hyperparameter sweep — no effect; (b) reference cleaning via resemble-enhance — no meaningful change; (c) period-prefix workaround — no effect; (d) multi-pass generation (8 takes) — best take still "sucks slightly less" per user. **Diagnostic root cause** (user observation 2026-05-14): Pocket TTS doesn't model pitch dynamics well — when reference voices have expressive pitch variation in short timespans (e.g., animated voice acting), the synthesis can't reproduce it cleanly. This is the same Iron Triangle constraint expressed at finer resolution: the architecture sacrificed expressive prosody for speed and cloning, and that's the binding ceiling.

**The "Iron Triangle" worth filing** for any future TTS evaluation — pick two of: CPU efficiency, zero-shot cloning, ElevenLabs-tier prosody. Pocket TTS picked efficiency + cloning. F5-TTS picks cloning + prosody. There's no engine that wins all three on commodity CPU; this is architectural, not implementation laziness.

**Reusable probe insights** (apply to any future CPU TTS candidate — preserved even though CPU path is closed, since they apply if GPU-compute decision changes the equation):

1. **TTFB > RTF for Discord** — RTF 0.8 is invisible to users if you stream sentence-chunked output (first sentence plays while sentences 2-N synthesize in parallel).
2. **Long-form (1-4 min) requires semantic chunking with last-3s carry-forward as new reference**. NO modern zero-shot model handles 4 min in one forward pass without hallucinating; this is universal.
3. **Sapphire Rapids (Xeon 8581C) has AMX + AVX-512** — ONNX/OpenVINO compile path _can_ beat naive CPU PyTorch on this hardware, but the F5-TTS probe revealed it's not a free 3-4x speedup; it's its own engineering effort.
4. **Thread thrashing is workload-dependent.** Council's prior was "don't use all 32 vCPUs"; F5-TTS contradicted this — fewer threads monotonically slower. Always sweep, don't assume.

**Status of other un-probed angles** (per 2026-05-14 honest exhaustion check):

- **Pocket TTS hyperparameter tuning** — **EMPIRICALLY EXHAUSTED 2026-05-14**. Knobs found in the `pocket_tts` package: `lsd_decode_steps` (default 1, the absolute minimum — analogous to NFE in flow matching), `temp` (default 0.7), `noise_clamp`, `eos_threshold`. Pocket TTS is FlowNet2 — same architectural family as F5-TTS. Hypothesis: bumping `lsd_decode_steps` from 1 (default minimum) up to 2/4/8 might dramatically improve quality, since flow-matching models typically need many denoising steps. Probed both ha-shem and emily references at lsd=1/2/4/8 plus temp=0.5/0.7/0.9 at lsd=4 (12 variants total, all level-matched -14 LUFS for fair A/B). User verdict on both reference voices: "I can barely discern any difference" / "they all sound bad to me." Speed measurements: lsd=1→8 takes RTF from 0.50 → 0.86 (linear scaling with iterations), so the knob ALSO has a real cost. **Conclusion**: unlike F5-TTS (which needs many NFE steps to converge), Pocket TTS appears to be heavily distilled — its 1-step output IS the converged output for this architecture. The "machine-y" quality is baked into the model itself, not a tunable parameter. **`lsd_decode_steps` is a measurable speed knob with no quality impact for this distilled model — don't probe again.**
- **Other voice conversion engines** (FreeVC, KNN-VC, SoftVC, RVC) — same dead end as TCC. VC fixes timbre, complaint is prosody/fidelity. Skip.
- **Multi-pass generation + selection** — **EMPIRICALLY EXHAUSTED 2026-05-14**. Pocket TTS IS stochastic — output durations varied 17.04s → 19.36s across 8 takes of identical input. But user verdict on best-of-8 emily takes (full-enhanced reference): "they all kinda suck but I guess #7 sucks slightly less." Even hand-curated best-of-8 (best-case offline scenario, perfect human selection) doesn't clear the quality bar. Automated selection couldn't possibly do better. Productionization story was already weak (no cheap automated MOS scorer that knows "this take handles pitch better than that one"); the empirical finding makes it moot anyway. The model's ceiling, not its stochastic distribution, is what's binding.
- **Reference cleaning (resemble-enhance)** — **EMPIRICALLY EXHAUSTED 2026-05-14**. Probed both denoise-only and full-enhancement modes on emily (Hazbin Hotel YouTube source) and ha-shem (Matrix oracle clip) refs, then fed cleaned refs through Pocket TTS. User verdict: not enough difference to easily tell. The references were already clean (movie/TV audio, not Discord-quality compressed), so the maintainer's "Pocket TTS reproduces acoustic conditions of the reference" mechanism didn't have noisy input to clean up. Resemble-enhance install gotcha: needs `git` on the container for model download (use HF `snapshot_download` to bypass) and outputs 32-bit float WAV that pocket_tts's `wave` module can't read (convert via ffmpeg `-c:a pcm_s16le`). Process: `pip install resemble-enhance`, then `resemble-enhance --device cpu [--denoise_only] in_dir out_dir`. CPU RTF: ~0.5 for denoise-only, ~6 for full enhancement.
- **Period-prefix workaround** (community fix from `kyutai-labs/pocket-tts` issue #91 — "first word garbled, smeared, or a tad deranged") — **EMPIRICALLY EXHAUSTED 2026-05-14**. Tested as part of the cleaned-refs sweep. No meaningful difference in user A/B. Either our refs already end at word boundaries (avoiding the issue), or our test text doesn't trigger the artifact strongly enough.
- **GPU-compute for voice-engine** (Modal / RunPod / Replicate / Banana / Fly.io GPU) — **the only remaining lever** to break the Iron Triangle's CPU constraint. Cost-per-request becomes a real concern (vs Railway CPU's $0.005/cold-start ballpark); ~$0.01-0.05/request typical for managed GPU inference services. Decision needs separate research and product judgment about user volume + willingness-to-pay-via-tier. Filing as the "next theme to consider" if BYOK quality-shopping also fails to satisfy.

**Sequence (revised after F5-TTS dropped)**:

1. **BYOK quality-shopping** is now the only forward path on the quality axis: Cartesia, Fish Audio, PlayHT, Resemble. API-call probes are fast and independent of any self-hosted work. See "Pivot plan" above.
2. **If BYOK doesn't satisfy** — decide whether to invest in GPU-hosted voice-engine (separate research theme, see status list above).
3. **Pocket TTS stays** as the free-tier self-hosted engine. Quality is what it is; that's the cost of free.

**Evaluation axes**: quality (subjective + reference-listener), model size + GPU requirements (for self-hosted candidates), license, voice-cloning fidelity, latency, cost (for BYOK candidates), reference-audio constraints (Mistral's 30s cap is a real limitation).

**Promote when**: BYOK quality-shopping headspace returns. Promoted from Inbox 2026-05-12.

---

#### Phase: RVC v2 per-voice training using ElevenLabs as one-shot data source (premium voice tier)

_The concrete consumer of the "GPU-compute for voice-engine" lever named in the status list above — moved here from `cold/ideas.md` 2026-07-03. Surfaced 2026-05-14 during BYOK quality discussion + Council brainstorm on TTS post-processing._

**Architecture**: pay one-shot for ElevenLabs subscription (~$22/month for Creator tier, cancel after data generation) to generate ~30 min of high-quality TTS output per selected personality voice; train per-voice RVC v2 models on that data offline (GPU rental ~$10-30 total via Modal/RunPod); deploy the trained `.pth` files (~75 MB each) to voice-engine; at inference time pipeline becomes Pocket TTS → RVC (per-voice) → output. RVC inference is RTF <0.1 on CPU per Council, vastly faster than the OpenVoice V2 zero-shot path (RTF 0.2-0.4). **Why this works** (vs the recursive Pocket-TTS-for-training-data approach Council noted as "Pocket TTS's clone, but cleaner"): the training data quality determines the output ceiling. ElevenLabs-generated data → RVC learns to convert any input into ElevenLabs-quality timbre. **Costs**: best case ~$10-30 (GPU training only — owner has existing ElevenLabs-generated audio in Discord history from prior subscription, sufficient training data for the personalities he actively cares about). Worst case ~$50 if a temporary EL resubscription is needed for additional voices. Then ~$0/inference forever.

**Data-extraction prerequisite (TOS-compliant via bot)**: Discord CDN URLs are signed and ~24h-windowed, but messages themselves are eternal. The Discord client doesn't cache URLs — it re-fetches messages via API and gets fresh signed URLs each time. The bot already has `READ_MESSAGE_HISTORY` in channels where personalities reply, so the extraction is normal API usage with the bot token, no scraping or user-session automation needed.

**Extraction script shape** (likely `pnpm ops voice-data:extract --personality <name>` or one-off):

- Walk guilds the bot is in → text channels it can read
- Paginate `channel.messages.fetch({ limit: 100, before: lastId })` (~50 msg/sec rate limit; full guild scan = hours, backgroundable)
- Filter `msg.webhookId !== null && targetPersonalityNames.includes(msg.author.username)` (webhook author username is the durable join key)
- For attachments matching `/^(voice\.mp3|.*::tts::.*\.ogg)$/` (handles both pre-2026-05 and post-rename filename conventions), download immediately via `attachment.url` (URL is fresh from the just-fired fetch, valid for ~24h)
- Output: `/data/voices/<personality_name>/<msg_id>.{mp3,ogg}` grouped per voice, ready for RVC training data assembly

**Side benefit of the extraction**: tells you which personalities have how much historical EL audio — natural input to deciding which voices justify RVC training (need ~10-30 min per voice). **Storage**: 75 MB × N premium voices = manageable (~5 GB for all 61, less if owner-curated). **Operational complexity**: per-voice training pipeline, model storage in DB or object store, voice-engine model loading, owner-driven enrollment. **UX shape**: probably labeled "premium voice" tier — most personas use OpenVoice V2 zero-shot (or whatever ships from the next-session probe), select few use RVC. Owner-only feature initially since training requires up-front data prep. **Promote when**: OpenVoice V2 (or whatever wins the BYOK bake-off) has shipped AND quality is still below user's bar AND owner is willing to invest the one-shot training cost. Likely a 2026-Q3 candidate, not immediate.

---

#### Sub-track: Pocket TTS post-processing chain — DROPPED 2026-05-14

Probed two complementary post-processing approaches; both ruled out. Documenting rationale so future quality work doesn't re-tread the same ground.

**(B) ffmpeg DSP chain** — probed 2026-05-13/14 with conservative (HP80 + compress + LUFS-norm) and aggressive (+ presence + de-ess) variants. Level-matched A/B verdict: "very similar" to raw + LUFS-norm baseline. **Verdict: not worth shipping standalone.**

**(C) OpenVoice V2 Tone Color Converter** — voice-conversion layer probed 2026-05-14. Install gotchas worth preserving for any future VC probe: container has no `git` (use tarball download), `se_extractor` module hardcodes `device="cuda"` AND pulls heavy whisper deps (PyAV needs system `pkg-config`) — bypass entirely by using the built-in `ToneColorConverter.extract_se()` method on the class itself. Minimal deps: torch, numpy, soundfile, librosa, inflect, unidecode, eng_to_ipa, pypinyin, cn2an, jieba, langid, wavmark, psutil. Two test runs:

1. **emily reference** (initial probe): RTF 0.218 ✅, output not truncated, peak RAM 1270 MB. Subjective verdict: pitch shift toward emily's higher F0 — register mismatch artifact. Tau sweep (0.1, 0.3, 0.5, 0.8) showed pitch shift is tau-independent → not a tunable knob.
2. **ha-shem-keev-ima reference** (hypothesis test): RTF 0.248 ✅, pitch shift gone (confirming register-mismatch hypothesis). Subjective verdict: "mixed bag — some moments cleaner, others noisier; feels like grasping for clarity but inconsistent in artifact presence."

**Why dropped**: A "mixed" win doesn't justify the complexity (10+ transitive deps, wavmark watermark dep is unmaintained, per-character behavior is reference-dependent so a per-personality `vc_postprocess` toggle UX would be needed). And — decisively — the user's underlying complaint about Pocket TTS quality isn't _timbre_ (TCC's domain), it's something closer to prosody/naturalness/fidelity that VC structurally cannot reach. Council's earlier framing — "VC fixes timbre, not prosody" — proved load-bearing.

**Honest forward path**: BYOK quality-shopping (Cartesia, Fish Audio, PlayHT) is the right axis. CPU-only voice cloning has a hard ceiling that no amount of post-processing crosses.

**Reusable probe pattern** (the scratch script was deleted per scripts/-is-for-one-offs rule, but worth preserving the shape for future voice probes that need a real reference clip):

```ts
// pnpm ops run --env prod npx tsx scripts/src/db/fetch-voice-ref.ts <slug> <out>
import { writeFileSync } from 'node:fs';
import { getPrismaClient } from '@tzurot/common-types';
const [, , slug, out] = process.argv;
const prisma = getPrismaClient();
const p = await prisma.personality.findFirst({
  where: { slug },
  select: { voiceReferenceData: true, displayName: true },
});
if (!p?.voiceReferenceData) throw new Error(`no ref for ${slug}`);
writeFileSync(out, p.voiceReferenceData);
console.log(`wrote ${p.voiceReferenceData.length} bytes (${p.displayName})`);
await prisma.$disconnect();
```

If we end up needing this 2+ more times, promote to `pnpm ops voice-refs:export <slug> <out>` rather than recreating the scratch.

**Reusable upload pattern** (railway ssh has no scp; argv length limit kills inline base64 for files >~500KB): `split -b 100000` the b64 into chunks, loop `printf '%s' "$chunk" >> /remote/file.b64` per chunk, decode on remote side. Verify with md5sum on both ends.

#### Candidate sweep from the 2026-07-05 links ingest (verified via web agent)

- **VoxCPM2 (OpenBMB)** — the strongest self-hosted candidate on paper: 2B tokenizer-free diffusion-AR, zero-shot + transcript-guided cloning, Apache-2.0, 1.84% WER (Seed-TTS-eval), RTF ~0.30 on a 4090 (~0.1 via vLLM-Omni), 32.5k stars, actively released (v2.0.3 May 2026).
- **OmniVoice (k2-fsa)** — 600+ languages, cloning + attribute-based voice design, Apache-2.0, RTF to 0.025; Kaldi-ecosystem pedigree; active.
- **MisoTTS (MisoLabs)** — 8B emotive English conversational TTS; **owner tested output: "isn't bad at all"**; caveats: ~24GB VRAM local (the 110ms latency claim is their hosted H100 TTFB), license unclear, thin commit history.
- **Chroma 1.0 (FlashLabs)** — different category: true speech-to-speech dialogue (audio→audio), 4B, open weights, cloning 0.81 speaker-sim (above human baseline claim), 147ms TTFT — relevant if the bot ever converses IN voice rather than TTS-ing text.
- **Kokoro** — local/offline TTS write-up (geeky-gadgets); known-quantity small model.
- **vLLM-Omni serving** (2026-06-23 blog) — serving-layer speedups (VoxCPM2 +172%, Qwen3-TTS +61.5%) — matters for any self-hosted pick's hosting math.

When this theme activates, start the bake-off from VoxCPM2 (license + quality + vLLM path) with MisoTTS as the emotive-quality comparison point.
