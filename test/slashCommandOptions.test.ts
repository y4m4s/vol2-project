import assert from "node:assert/strict";
import test from "node:test";
import { getMatchingSlashCommands, PROVIDER_GROUP_COMMAND_TEXT } from "../src/shared/slashCommandOptions";

test("空クエリではプロバイダコマンドをまとめ入口1件だけ表示する", () => {
  const options = getMatchingSlashCommands("");
  const providerEntries = options.filter((option) => option.commandText.startsWith("/provider"));
  assert.deepEqual(
    providerEntries.map((option) => option.commandText),
    [PROVIDER_GROUP_COMMAND_TEXT]
  );
});

test("/provider を入力すると4択に展開する", () => {
  const options = getMatchingSlashCommands("provider");
  assert.deepEqual(
    options.map((option) => option.commandText).sort(),
    ["/provider-cp", "/provider-lm", "/provider-oll", "/provider-orca"].sort()
  );
});

test("/provider- で絞り込んでも4択のままになる", () => {
  const options = getMatchingSlashCommands("provider-");
  assert.equal(options.length, 4);
});

test("/provider-lm のように個別コマンド名まで入力すると1件に絞られる", () => {
  const options = getMatchingSlashCommands("provider-lm");
  assert.deepEqual(options.map((option) => option.commandText), ["/provider-lm"]);
});

test("プロバイダと無関係なクエリでは通常の一覧をフィルタする", () => {
  const options = getMatchingSlashCommands("hint");
  assert.deepEqual(options.map((option) => option.commandText), ["/hint"]);
});
