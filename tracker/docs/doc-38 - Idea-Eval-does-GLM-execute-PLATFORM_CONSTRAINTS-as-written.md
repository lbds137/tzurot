---
id: doc-38
title: 'Idea: Eval: does GLM execute PLATFORM_CONSTRAINTS as written?'
type: other
created_date: '2026-07-28 11:11'
---

## Eval: does GLM execute PLATFORM_CONSTRAINTS as written?

The permissive-ambiguity calibration in `HardcodedConstraints.ts` is a deliberate owner decision, but the volume tier is GLM — a prose constraint is only as good as the model reading it. Build a small manual eval suite (rides `vitest.eval.config.ts`, never CI) feeding boundary cases and scoring whether the "explicitly frames as a minor" test is applied AS WRITTEN, measuring BOTH failure directions (false-block and false-pass). **Design the case set with the owner before writing it.** Filed 2026-07-07 (external Fable review, optional/design-first).

