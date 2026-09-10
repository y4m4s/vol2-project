# AIプロバイダーの実装

確認日: 2026-09-09。各文書はこのリポジトリの実装を説明する。サービス側の最新プランや全API機能を保証するものではない。

| プロバイダー | 内部ID | モデル検出 | 接続先・認証 |
|---|---|---|---|
| [LM Studio](lm-studio.md) | `lmStudio` | ロード中のLLM | localhost限定、APIトークン未対応 |
| [Ollama](ollama.md) | `ollama` | インストール済みモデル | HTTP(S)ルートURLを編集可能、認証設定なし |
| [GitHub Copilot](github-copilot.md) | `copilot` | VS Codeが公開するモデル | VS Codeの認証・モデル利用同意 |
| [OrcaRouter](orca-router.md) | `orcaRouter` | テキスト対応モデルと固定ルーター | 固定HTTPS URL、SecretStorageのAPIキー |

## 共通の接続・生成経路

`ConnectionSettingsCoordinator` が設定保存・再接続を扱い、`ConnectionService` が `ConnectedProviderModel` を生成する。`AdviceService` はその `requestText()` を通じて回答とナレッジを生成する。接続にはWorkspace Trustが必要。

既定のプロバイダーはCopilot。接続先と選択モデルはワークスペースの `workspaceState` に保存する。APIキーは別管理で、OrcaRouterだけがSecretStorageを使用する。

接続切り替え失敗時は原則として直前の接続を復元する。LM StudioにはCopilotへ設定を戻す処理、Ollamaには削除済みモデルの接続を復元しない処理があるため、詳細は各文書を参照する。生成失敗時に同じ質問を別プロバイダーへ自動転送しない。

回答は生成完了後に表示する。通常の回答生成では過去の会話履歴を自動追加せず、ナレッジ作成時は保存対象の周辺メッセージを扱う。送信内容は [送信予定と実際の送信内容](../request-plan-transmission.md)、出力打ち切りは [出力上限への対応](../output-limit-handling.md) を参照する。

日次トークンガードは4種類すべてに適用し、プロバイダーごとの当日使用量で判定する。自動助言は上限で停止し、手動相談は警告を表示する。利用量表示・日次ガードはNaviCom内の計測であり、サービス側の残高取得ではない。LM StudioとOllamaの記録料金は0として扱う。会話・ナレッジはプロバイダーIDとモデルIDを記録し、旧データは従来のモデルラベルで表示する。

## 主な実装

- [ConnectionService.ts](../../src/services/ConnectionService.ts): 接続、モデル選択、共通モデルの構築
- [ConnectionSettingsCoordinator.ts](../../src/application/coordinators/ConnectionSettingsCoordinator.ts): 設定と接続切り替え
- [SettingsService.ts](../../src/services/SettingsService.ts): 保存・既定値
- [AdviceService.ts](../../src/services/AdviceService.ts)、[UsageMeter.ts](../../src/services/UsageMeter.ts): 生成と利用量
- [設定画面](../../src/views/screens/s06-settings.tsx)、[共通型](../../src/shared/types.ts)

プロバイダー文書は番号付きの機能設計書から分離して管理する。旧LLM切り替え設計、LM Studioサーバー操作手順、Copilot接続制限調査、OrcaRouter導入設計の実装情報はここへ統合した。
