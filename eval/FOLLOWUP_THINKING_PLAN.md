# Thinking / automatic intervention — preregistration

2026-09-16. No model/global/backend configuration changes. Same Qwen3 8B Q4_K_M, production clients. Two separate interventions; no combined candidate during selection.

## Data

`algorithms-v2` tuning explicitly promotes the previously observed algorithm tuning AND holdout to development/regression data. Neither is called unseen evidence again. Fresh holdout contains maximum contiguous subarray, balanced parentheses, GCD and merging sorted arrays, each correct/buggy in Python/JavaScript. Freeze its case hash before model acquisition. These fixtures are original; their execution references never enter model prompts.

## Round T — Thinking only

Screen four fixed cases per provider: lower-bound-py, pair-bug-js, sum-correct-py, sum-bug-js. One paired sample each, same max output tokens and sampling, change only none→high (provider maps to on). Interleave OFF/ON and balance which goes first. Save actual reasoning token/character counts, truncation, timeout and end-to-end latency. A single pilot is not statistical quality evidence.

Do not expand a provider's pilot if ON has at least two delivery/hard-check failures, or median latency exceeds three times OFF, or no thinking is observed. Review every acquired answer regardless. This is a feasibility gate for the current interactive pipeline, not a claim about the model's maximum reasoning capability. With two or more output-limit failures, permit one additional diagnostic pair at 4096 output tokens on lower-bound-py; keep OFF and ON otherwise identical. Do not silently increase the production timeout (120 seconds).

If feasible, run both languages of the four pilot tasks (8 cases), two paired repeats as exploration; require a larger confirmation before any default rollout. Production adoption still requires existing rubric gates (including <=25% unexplained latency increase). Prefer keeping the current default over trading large latency for uncertain quality.

## Round A — intervention evidence policy only

Thinking stays OFF. Append one general policy only for automatic requests: identify a concrete condition, current behavior and unmet requirement; issue a brief hint for a demonstrated deficiency, otherwise no_advice. Mere execution uncertainty, restating satisfied requirements, praise and generic checking are not reasons to speak. Preserve actual return/output contract. Never add an automatic text filter that hides errors or all advice.

Use 14 cases: both languages of sum-incomplete plus the 12 automatic cases in the previously observed algorithm holdout (prefix correct/bug, BFS correct, stairs bug, sort correct/bug). Two paired repeats per provider (28 comparisons each). Include all incorrect/incomplete cases to detect silence regressions. Problem groups, not translated variants/repeats, are the bootstrap units.

Adoption: no new hard failures, no decline in defective-case task success or increase in missed-by-silence count, lower unnecessary-advice count on correct cases, critical axes not worse by >0.25, quality CI lower bound >0.5, and latency within existing rubric gate. Codex reviews blinded A/B, with shared-design limitation disclosed. More silence alone is never success. Retain rejected runs.

## Confirmation

Only after a candidate qualifies on tuning, run the fresh holdout with baseline/candidate once per relevant provider. Do not optimize after reading it. If none qualifies, leave the new holdout unused for a future experiment. Record the bottleneck and next hypothesis, without declaring an 8B capability ceiling from an OFF-mode or timeout-limited experiment.

API references: [LM Studio request reasoning and token stats](https://lmstudio.ai/docs/developer/rest/chat), [Ollama reasoning_effort](https://docs.ollama.com/api/openai-compatibility). Actual locally observed behavior, not just documented support, determines whether a toggle worked.

## Reproduction

```powershell
npm run test:quality-eval
node eval/run-paired.mjs --baseline eval/configs/af-lm-off.json --candidate eval/configs/af-lm-on.json --out eval/results/new-lm-thinking --ids alg-lower-bound-py,alg-pair-bug-js,alg-sum-correct-py,alg-sum-bug-js
node eval/paired-diagnostics.mjs eval/results/new-lm-thinking
node eval/compare.mjs --baseline eval/results/new-lm-thinking-baseline --candidate eval/results/new-lm-thinking-candidate --out eval/results/new-lm-thinking-comparison

$evalIds = ((Get-Content eval/results/af-automatic-selection.json -Raw | ConvertFrom-Json).ids -join ',')
node eval/run-paired.mjs --baseline eval/configs/af-lm-off.json --candidate eval/configs/af-lm-evidence.json --out eval/results/new-lm-automatic --ids $evalIds --repeat 2
```

Use the `af-oll-*` configs for Ollama and a new output prefix. Run providers serially. Give only `blind.json` to the judge, then use the existing `report.mjs` and `algorithm-report.mjs`. `run-paired.mjs --resume` with the identical arguments resumes missing observations only after the earlier process has stopped. Recorded failures remain failures, never silently replaced by successful retries. Each arm's complete requests, case snapshots and metadata remain in its separate baseline/candidate directory.
