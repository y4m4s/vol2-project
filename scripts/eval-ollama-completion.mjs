// Backwards-compatible Ollama entry point.
process.argv.splice(2, 0, "--provider", "ollama");
await import("./eval-local-completion.mjs");
