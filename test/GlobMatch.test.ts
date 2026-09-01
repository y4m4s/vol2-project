import assert from "node:assert/strict";
import test from "node:test";
import { globToRegExp, isPathExcluded } from "../src/services/globMatch";
import { PROTECTED_EXCLUDED_GLOBS } from "../src/services/protectedGlobs";

// 実行するプラットフォームに結果が左右されないよう、常に明示する。
const insensitive = { caseInsensitive: true };
const sensitive = { caseInsensitive: false };

test("保護 glob は綴りの大小が違っても機密ファイルを除外する", () => {
  const protectedGlobs = PROTECTED_EXCLUDED_GLOBS;
  const excluded = [
    "C:/proj/.env",
    "C:/proj/.ENV",
    "C:/proj/.env.local",
    "C:/proj/local.env",
    "C:/proj/config/secrets.json",
    "C:/proj/config/SECRETS.json",
    "C:/proj/config/Secret.yaml",
    "C:/proj/certs/server.pem",
    "C:/proj/certs/server.PEM",
    "C:/proj/.aws/credentials",
    "C:/proj/.ssh/id_ed25519",
    "C:/proj/terraform.tfvars",
    "C:/proj/node_modules/pkg/index.js"
  ];

  for (const filePath of excluded) {
    assert.equal(isPathExcluded(filePath, protectedGlobs, insensitive), true, `${filePath} should be excluded`);
  }
});

test("保護 glob は通常のソースファイルを巻き込まない", () => {
  const kept = [
    "C:/proj/src/app.ts",
    "C:/proj/README.md",
    "C:/proj/src/environment.ts",
    "C:/proj/docs/02-requirements.md"
  ];

  for (const filePath of kept) {
    assert.equal(
      isPathExcluded(filePath, PROTECTED_EXCLUDED_GLOBS, insensitive),
      false,
      `${filePath} should not be excluded`
    );
  }
});

test("大文字小文字を区別するファイルシステムでは綴りの違いを別物として扱う", () => {
  assert.equal(isPathExcluded("C:/proj/.env", ["**/.env"], sensitive), true);
  assert.equal(isPathExcluded("C:/proj/.ENV", ["**/.env"], sensitive), false);
});

test("ユーザー設定のブレース glob を展開する", () => {
  const patterns = ["**/{secrets,private}/**"];
  assert.equal(isPathExcluded("C:/proj/secrets/a.json", patterns, insensitive), true);
  assert.equal(isPathExcluded("C:/proj/private/a.json", patterns, insensitive), true);
  assert.equal(isPathExcluded("C:/proj/public/a.json", patterns, insensitive), false);

  const extensions = ["**/*.{pem,key}"];
  assert.equal(isPathExcluded("C:/proj/a.key", extensions, insensitive), true);
  assert.equal(isPathExcluded("C:/proj/a.pem", extensions, insensitive), true);
  assert.equal(isPathExcluded("C:/proj/a.txt", extensions, insensitive), false);
});

test("globstar は前置ディレクトリがなくても一致する", () => {
  assert.equal(isPathExcluded(".env", ["**/.env"], insensitive), true);
  assert.equal(isPathExcluded("src/.env", ["**/.env"], insensitive), true);
  assert.equal(isPathExcluded("C:/proj/src/.env", ["**/.env"], insensitive), true);
});

test("単一のアスタリスクはディレクトリ区切りを越えない", () => {
  assert.equal(isPathExcluded("docs/a.md", ["docs/*"], insensitive), true);
  assert.equal(isPathExcluded("docs/nested/a.md", ["docs/*"], insensitive), false);
  assert.equal(isPathExcluded("docs/nested/a.md", ["docs/**"], insensitive), true);
});

test("? は 1 文字に一致する", () => {
  assert.equal(isPathExcluded("src/a.ts", ["src/?.ts"], insensitive), true);
  assert.equal(isPathExcluded("src/ab.ts", ["src/?.ts"], insensitive), false);
});

test("正規表現のメタ文字はリテラルとして扱う", () => {
  assert.equal(isPathExcluded("src/a+b.ts", ["src/a+b.ts"], insensitive), true);
  assert.equal(isPathExcluded("src/aab.ts", ["src/a+b.ts"], insensitive), false);
  assert.equal(isPathExcluded("src/report(1).md", ["src/report(1).md"], insensitive), true);
});

test("Windows のバックスラッシュ区切りを正規化する", () => {
  assert.equal(isPathExcluded("C:\\proj\\.env", ["**/.env"], insensitive), true);
  assert.equal(isPathExcluded("C:/proj/.env", ["**\\.env"], insensitive), true);
});

test("同じパターンでは同一の RegExp を再利用する", () => {
  assert.equal(globToRegExp("**/*.ts", insensitive), globToRegExp("**/*.ts", insensitive));
  assert.notEqual(globToRegExp("**/*.ts", insensitive), globToRegExp("**/*.ts", sensitive));
});
