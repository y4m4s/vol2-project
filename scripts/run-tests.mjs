import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const tests = readdirSync(".test-out/test").filter(name => name.endsWith(".test.js")).map(name => `.test-out/test/${name}`);
const result = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
