import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveHomeScreen,
  resolveScreenAfterFailure,
  resolveScreenAfterSuccess
} from "../src/application/coordinators/NavigationCoordinator";

test("接続状態からホーム画面を解決する", () => {
  assert.equal(resolveHomeScreen("connected"), "main");
  assert.equal(resolveHomeScreen("unavailable"), "error");
  assert.equal(resolveHomeScreen("restricted"), "error");
  assert.equal(resolveHomeScreen("disconnected"), "onboarding");
});

test("手動助言の成功時もユーティリティ画面を維持する", () => {
  assert.equal(resolveScreenAfterSuccess("manual", "history"), "history");
  assert.equal(resolveScreenAfterSuccess("context", "main"), "conversation");
});

test("自動助言の失敗時に現在画面と接続状態を考慮する", () => {
  assert.equal(resolveScreenAfterFailure("always", "settings", "unavailable", false), "settings");
  assert.equal(resolveScreenAfterFailure("always", "main", "restricted", true), "main");
  assert.equal(resolveScreenAfterFailure("always", "main", "unavailable", false), "error");
  assert.equal(resolveScreenAfterFailure("manual", "knowledge", "connected", false), "knowledge");
});
