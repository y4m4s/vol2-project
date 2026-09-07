import assert from "node:assert/strict";
import test from "node:test";
import type { OrcaRouterModel } from "../src/services/OrcaRouterClient";
import { createBuiltInOrcaRouterOptions, toOrcaRouterModelOptions } from "../src/services/OrcaRouterModelPolicy";

function model(id: string, overrides: Partial<OrcaRouterModel> = {}): OrcaRouterModel {
  return { id, ownedBy: "test", supportedEndpointTypes: ["openai"], inputModalities: ["text"], outputModalities: ["text"], ...overrides };
}

test("無料ルート・課金ルート・料金未取得を区別し不明を無料扱いしない", () => {
  const options = toOrcaRouterModelOptions([
    model("orcarouter/free"), model("orcarouter/auto"), model("vendor/test-free"), model("vendor/test")
  ]);
  assert.equal(options.find((x) => x.id === "orcarouter/free")?.billingCategory, "free");
  assert.equal(options.find((x) => x.id === "orcarouter/auto")?.billingCategory, "metered");
  assert.equal(options.find((x) => x.id === "vendor/test-free")?.billingCategory, "free");
  assert.equal(options.find((x) => x.id === "vendor/test")?.billingCategory, "unknown");
});

test("未取得の固定モデルには欠落警告を出さない", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  assert.ok(createBuiltInOrcaRouterOptions().every((option) => !option.availabilityWarning));
  assert.equal(warn.mock.callCount(), 0);
});

test("取得一覧にない固定モデルは警告付きで保持し、再取得で警告を解消する", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const options = toOrcaRouterModelOptions([model("orcarouter/free"), model("vendor/model")]);
  assert.equal(options.find((option) => option.id === "orcarouter/free")?.availabilityWarning, undefined);
  assert.match(options.find((option) => option.id === "orcarouter/auto")?.availabilityWarning ?? "", /モデル一覧にありません/);
  assert.equal(warn.mock.callCount(), 1);
  assert.deepEqual(warn.mock.calls[0].arguments[1], { modelId: "orcarouter/auto" });

  const refreshed = toOrcaRouterModelOptions([model("orcarouter/free"), model("orcarouter/auto")]);
  assert.ok(refreshed.every((option) => !option.availabilityWarning));
  assert.equal(warn.mock.callCount(), 1);
});

test("空の取得一覧では両固定モデルに警告する", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const options = toOrcaRouterModelOptions([]);
  assert.equal(options.length, 2);
  assert.ok(options.every((option) => option.availabilityWarning));
  assert.equal(warn.mock.callCount(), 2);
});

test("固定モデルの表示名・先頭配置・能力メタデータを保持する", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const options = toOrcaRouterModelOptions([
    model("orcarouter/free", { contextLength: 12000 }),
    model("orcarouter/auto"),
    ...Array.from({ length: 300 }, (_, i) => model(`vendor/aaa${i}`))
  ]);
  assert.equal(options.length, 300);
  assert.deepEqual(options.slice(0, 2).map((option) => [option.label, option.isRouter]), [["Auto Router", true], ["Free Router", true]]);
  assert.equal(options[1].contextLength, 12000);
  assert.equal(warn.mock.callCount(), 0);
});

test("非対応モデルのフィルタを維持し、固定モデルの能力変更を警告する", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const options = toOrcaRouterModelOptions([
    model("orcarouter/free", { inputModalities: ["image"] }),
    model("orcarouter/auto"),
    model("vendor/image", { outputModalities: ["image"] }),
    model("vendor/other", { supportedEndpointTypes: ["other"] }),
    model("vendor/unknown", { supportedEndpointTypes: [], inputModalities: [], outputModalities: [] })
  ]);
  assert.equal(options.length, 3);
  assert.match(options.find((option) => option.id === "orcarouter/free")?.availabilityWarning ?? "", /テキスト会話/);
  assert.ok(options.some((option) => option.id === "vendor/unknown"));
  assert.equal(warn.mock.callCount(), 1);
});
