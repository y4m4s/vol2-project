# 15. GitHub Copilot プランと接続制限の調査

- 最終確認日: 2026-08-20
- 対象: NaviCom の GitHub Copilot 接続（VS Code Language Model API 経由）

## 結論

NaviCom は GitHub Copilot のプラン名を取得せず、プラン別の利用可否も独自に判定しない。
接続可否は、VS Code Language Model API が返すモデル、そのモデルに対する利用同意、GitHub 側の利用上限・ポリシーに従う。

GitHub の現行仕様では、Copilot Free と Copilot Student も Copilot を利用できる。ただし、両プランのモデル利用は Auto モデル選択に限定され、チャットやエージェントには月次の AI Credits 上限がある。そのため、「Free ではモデルが一切提供されない」「Student 以上でなければ NaviCom を起動できない」という説明は正しくない。

## 現行プランの整理

個人向けには、次のプランが案内されている。

- GitHub Copilot Free
- GitHub Copilot Student
- GitHub Copilot Pro
- GitHub Copilot Pro+
- GitHub Copilot Max

Free は月間 2,000 件までのコード補完と AI Credits の枠を含む。Student は認証済みの学生が無料で利用でき、コード補完は無制限だが、Free と同様にチャット・エージェントのモデルは Auto 選択のみで、AI Credits の枠が適用される。

価格、クレジット付与量、利用可能モデルは変更される可能性があるため、このリポジトリには固定値を複製しない。最新値は GitHub 公式の[個人向けプラン比較](https://docs.github.com/en/copilot/concepts/billing/individual-plans)と[対応モデル一覧](https://docs.github.com/en/copilot/reference/ai-models/supported-models)を正とする。

## 課金・利用上限

2026年6月1日以降、GitHub Copilot の標準的な利用量計測は、モデルとトークン量に基づく [GitHub AI Credits へ移行](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/what-changed-with-billing)した。1 AI Credit は課金上 0.01 USD に相当する。

既存の年額 Copilot Pro / Pro+ 契約者の一部は、契約終了まで旧 premium requests 方式を継続できる。この方式はレガシー扱いであり、現行仕様を premium requests だけで説明してはならない。

NaviCom が表示する「今日の利用回数・概算トークン・推定料金」と「1日の使用上限」は、NaviCom 内で計測するローカルな目安である。GitHub の AI Credits 残高、請求額、月次上限を取得した値ではなく、GitHub 側の利用を保証または制限するものでもない。

VS Code Language Model API の応答からは、GitHub の請求明細や実消費 AI Credits を取得できない。NaviCom の概算には、Auto 選択で実際に使われたモデル、キャッシュ済み入力などの課金要素が完全には反映されないため、請求額として扱わない。正確な使用量は GitHub の [AI Credits 使用量画面](https://docs.github.com/en/copilot/how-tos/manage-and-track-spending/monitor-ai-usage)で確認する。

## NaviCom の接続実装

NaviCom は GitHub の課金 API を直接呼ばず、次の順で接続する。

1. `vscode.lm.selectChatModels({ vendor: "copilot" })` で、その環境から見えるモデルを取得する。
2. 初回結果が空なら、1.5秒後に一度だけ再取得する。
3. モデル指定がなければ、Auto モデルが返っている場合はそれを優先する。
4. Auto モデルがなければ、利用可能な手動選択モデルから接続対象を決める。
5. ユーザー操作を起点に短い probe を送信し、同意と実リクエストの成功を確認する。

この実装は Free / Student の Auto 選択に対応している。以前存在した特定の低コストモデル ID による固定優先リストは、現在の `ConnectionService` には存在しない。

`vscode.LanguageModelChat` が公開するのは、モデルの `id`、`name`、`vendor`、`family`、`version`、入力上限などであり、ユーザーの Copilot プラン名や AI Credits 残高ではない。そのため、NaviCom はモデル一覧が空という事実だけから「Free プランが原因」と断定できない。

## 接続できない場合の確認順

1. VS Code で GitHub にサインインし、Copilot の AI 機能が有効になっているか確認する。未契約の個人ユーザーは VS Code から Copilot Free を開始できる。
2. Copilot Free / Student / 有料プランの有効化状態と AI Credits 使用量を GitHub の設定で確認する。
3. VS Code と Copilot 関連機能を最新版へ更新する。
4. ワークスペースが Trusted であることを確認する。
5. NaviCom の接続操作で表示されるモデル利用同意を許可する。
6. `selectChatModels` が空か、`canSendRequest` が `false` か、`sendRequest` が失敗したかをログで区別する。
7. `LanguageModelError` の `NoPermissions`、`Blocked`、`NotFound` を区別する。`Blocked` には利用上限超過が含まれ得るが、エラー理由をプラン名だけに決め打ちしない。

Free / Student では手動モデル選択肢が表示されなくても、Auto モデルで接続できる場合がある。反対に、有料プランでも組織ポリシー、同意状態、一時的なレート制限、モデル廃止などによって接続できない場合がある。

## 実装上の注意

- 特定モデル ID は追加・変更・廃止されるため、接続要件として固定しない。
- VS Code API が返すモデルと `canSendRequest` の結果を実行時の事実として扱う。
- probe もモデル利用を伴うため、NaviCom のローカル利用量へ記録する。
- GitHub のエンタイトルメント、組織ポリシー、利用上限を迂回する処理は実装しない。
- LM Studio は Copilot のプランや AI Credits に依存しない代替プロバイダーとして扱う。

## 参照した公式情報

- [GitHub Copilot の個人向けプランと特典](https://docs.github.com/en/copilot/concepts/billing/individual-plans)
- [GitHub Copilot の対応モデル](https://docs.github.com/en/copilot/reference/ai-models/supported-models)
- [GitHub Copilot のモデル価格](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)
- [GitHub Copilot の課金方式変更](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/what-changed-with-billing)
- [GitHub Copilot の利用上限](https://docs.github.com/en/copilot/concepts/usage-limits)
- [学生向け GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students)
- [VS Code で GitHub Copilot を設定する](https://code.visualstudio.com/docs/setup/copilot)
- [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model)
- [VS Code API: LanguageModelChat](https://code.visualstudio.com/api/references/vscode-api#LanguageModelChat)
