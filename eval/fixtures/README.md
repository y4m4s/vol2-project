# Fixture boundary

Synthetic editor snapshots represent the OUTPUT of ContextCollector, before RequestPlanner. No private workspace files or saved conversations are harvested. Existing task-completion failures in src/eval/taskCompletionScenarios.ts are reused in tuning only. Collector viewport selection and VS Code UI are outside this harness; planner, prompt builder, transport, validation and one format repair use production code. Long active excerpts stay within the collector's 8,000-character limit. Additional context stress inputs deliberately exceed the prompt budget.
