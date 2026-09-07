/**
 * ユーザーが外せない送信除外パターン。
 *
 * 判定は globMatch が行い、Windows / macOS では大文字小文字を区別しない。
 * ここを直接テストできるよう、vscode に依存しないモジュールとして切り出している。
 */
export const PROTECTED_EXCLUDED_GLOBS: readonly string[] = [
  // バージョン管理・依存・ビルド生成物（機密ではないが送っても役に立たない）
  "**/.git/**",
  "**/.hg/**",
  "**/.svn/**",
  "**/node_modules/**",
  "**/vendor/**",
  "**/.venv/**",
  "**/venv/**",
  "**/env/**",
  "**/__pycache__/**",
  "**/.pytest_cache/**",
  "**/.mypy_cache/**",
  "**/.ruff_cache/**",
  "**/.cache/**",
  "**/.turbo/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.svelte-kit/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/target/**",
  "**/bin/**",
  "**/obj/**",

  // 資格情報が入りやすいファイル
  "**/.env",
  "**/.env.*",
  "**/*.env",
  "**/.npmrc",
  "**/.yarnrc.yml",
  "**/.netrc",
  "**/_netrc",
  "**/.git-credentials",
  "**/.aws/**",
  "**/.azure/**",
  "**/.gcloud/**",
  "**/.ssh/**",
  "**/.docker/config.json",
  "**/.dockercfg",
  "**/.kube/config",
  "**/*secret*",
  "**/*credential*",
  "**/*.pem",
  "**/*.key",
  "**/*.p8",
  "**/*.p12",
  "**/*.pfx",
  "**/*.jks",
  "**/*.keystore",
  "**/*.tfvars",
  "**/id_rsa",
  "**/id_ed25519",

  // テキストとして送っても意味がない、または巨大なもの
  "**/*.sqlite",
  "**/*.sqlite3",
  "**/*.db",
  "**/*.zip",
  "**/*.tar",
  "**/*.tar.gz",
  "**/*.tgz",
  "**/*.7z",
  "**/*.rar"
];
