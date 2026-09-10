import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const exec = promisify(execFile);
for (const provider of ["lmStudio", "ollama"]) for (const depth of ["low", "high"]) {
  test(`${provider} ${depth}: production request, repair and report`, async () => {
    const requests = [];
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: {
        content: requests.length === 1 ? "invalid" : '{"kind":"no_advice","focus":"none"}',
        reasoning: "private reasoning"
      } }], usage: { prompt_tokens: 30, completion_tokens: 12 } }));
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const directory = await mkdtemp(join(tmpdir(), "navicom-eval-"));
    try {
      const output = join(directory, "report.json");
      await exec(process.execPath, [`scripts/eval-${provider === "lmStudio" ? "lmstudio" : "ollama"}-completion.mjs`, "--model", "qwen/test",
        "--base-url", `http://127.0.0.1:${server.address().port}`, "--filter", "hello-reported",
        "--depth", depth, "--output", output]);
      assert.equal(requests.length, 2);
      for (const request of requests) {
        assert.equal(request.model, "qwen/test");
        assert.equal(request.max_tokens, provider === "ollama" || depth === "high" ? 8192 : 2048);
        assert.equal(request.reasoning_effort, provider === "ollama" ? depth === "high" ? "high" : "none" : undefined);
      }
      const saved = await readFile(output, "utf8");
      assert.doesNotMatch(saved, /private reasoning/);
      const report = JSON.parse(saved);
      assert.equal(report.provider, provider);
      assert.equal(report.report.failed, 0);
      assert.equal(report.responses[0].attempts.length, 2);
      assert.deepEqual(report.responses[0].reasoningChars, [17, 17]);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      assert.ok(directory.startsWith(join(tmpdir(), "navicom-eval-")));
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("LM Studio requires a model and rejects Ollama reasoning overrides", async () => {
  await assert.rejects(exec(process.execPath, ["scripts/eval-lmstudio-completion.mjs"]), /requires --model/);
  await assert.rejects(exec(process.execPath, ["scripts/eval-lmstudio-completion.mjs", "--model", "test",
    "--reasoning-effort", "high"]), /server reasoning settings/);
});
