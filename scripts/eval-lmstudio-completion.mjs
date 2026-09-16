process.argv.splice(2, 0, "--provider", "lmStudio");
await import("./eval-local-completion.mjs");
