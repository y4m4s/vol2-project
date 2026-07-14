import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLmStudioCliStatus,
  parseLmStudioLocalServerUrl
} from "../src/services/LmStudioServerProtocol";

test("LM Studio CLI の起動状態JSONを解析する", () => {
  assert.deepEqual(
    parseLmStudioCliStatus('{"running":true,"port":1234}'),
    { running: true, port: 1234 }
  );
  assert.deepEqual(
    parseLmStudioCliStatus('{"running":false,"port":1234}'),
    { running: false, port: 1234 }
  );
});

test("ログ行の後ろにある状態JSONを解析する", () => {
  assert.deepEqual(
    parseLmStudioCliStatus('Waking up LM Studio service...\n{"running":true,"port":4321}\n'),
    { running: true, port: 4321 }
  );
});

test("不正な状態JSONを拒否する", () => {
  assert.throws(
    () => parseLmStudioCliStatus('{"port":1234}'),
    /invalid status JSON/
  );
});

test("ローカルのLM Studio URLだけを許可する", () => {
  assert.deepEqual(
    parseLmStudioLocalServerUrl("http://127.0.0.1:1234"),
    { origin: "http://127.0.0.1:1234", port: 1234 }
  );
  assert.deepEqual(
    parseLmStudioLocalServerUrl("http://localhost:4321/"),
    { origin: "http://localhost:4321", port: 4321 }
  );
  assert.throws(() => parseLmStudioLocalServerUrl("https://example.com:1234"));
  assert.throws(() => parseLmStudioLocalServerUrl("http://127.0.0.1:1234/v1"));
});
