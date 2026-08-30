# NaviCom

[![Powered by OrcaRouter](https://img.shields.io/badge/Powered_by-OrcaRouter-2563eb)](https://www.orcarouter.ai/ref/ref_ca9caab6221888bc490e)

**ペアプログラミングのナビゲーター役を担う、VS Code 向け AI 学習支援拡張機能**

NaviCom は、コーディング中の詰まりを自力で解決する力を育てることを目的とした VS Code 拡張機能です。  
GitHub Copilot、LM Studio、OrcaRouterを利用し、「答えの代行」ではなく「考え方・観点・切り分け方」の提示に特化したアドバイスを提供します。

---

## コンセプト

- ペアプログラミングにおけるナビゲーター役を AI に担わせる
- 正解を与えるのではなく、考えるための観点・確認ポイント・次に見るべき箇所を提案する
- コードの変更・自動実行・ターミナル操作は行わない
- 詰まりや学びを個人ナレッジとして手元に蓄積し、次回以降に活かせるようにする

---

## できること

### 文脈を踏まえた AI 相談

現在開いているファイル・選択範囲・診断情報・直近の編集内容・関連シンボルを自動で収集し、プロジェクトの文脈に沿ったアドバイスを返します。入力欄から自由なテキストで補足情報を追加することもできます。

入力欄の「送信予定」表示では、送信する情報のカテゴリ、対象ファイル、概算サイズを確認できます。通常はコンパクトに表示され、必要なときだけ詳細を展開できます。外部AIへ送るファイルパスはワークスペース相対パスへ変換されます。

### 会話の継続

相談ごとに独立した会話ストリームが作成されます。最初の質問を送ると専用の会話画面に移行し、続けて補足質問や深掘りができます。過去の相談は履歴画面からいつでも再開できます。回答に表示された参照ファイルは、一覧からクリックしてVS Codeのエディタで開けます。履歴とナレッジの削除は、誤操作を防ぐため二度押しで確定します。

### 常時モードと必要時モード

- **必要時モード**: 
　ユーザーが明示的に質問を送ったときだけアドバイスを返します。
- **常時モード**: 
　編集・選択・診断の変化をトリガーに、自動で作業文脈を読んでフィードバックします。
　発話頻度はアイドル時間・インターバル・重複抑制・一時停止で制御されます。

### 個人ナレッジの蓄積と再利用

有用な回答をナレッジとして保存できます。
保存されたナレッジは以降の回答生成時に参照され、検索・閲覧・削除・元会話への遡りが可能です。
ナレッジ本体はローカルの SQLite に保存されます。ただし、回答生成時に再利用対象となったナレッジのタイトル・要約は、プロンプトの一部として選択中のAI接続先へ送信されます。

---

## 技術構成

| 領域 | 技術 |
|------|------|
| 拡張機能ホスト | TypeScript / VS Code Extension API |
| UI | React / WebviewView |
| AI 呼び出し | VS Code Language Model API (GitHub Copilot) / LM Studio / OrcaRouter |
| ローカルストレージ | SQLite (sql.js) |
| ビルド | esbuild / TypeScript Compiler |

### ディレクトリ構成

```
src/
├── extension.ts                   # 拡張機能エントリポイント
├── application/
│   ├── NavigatorController.ts     # 画面状態・ユースケース制御
│   └── SessionStore.ts            # セッション状態管理
├── services/                      # AI呼び出し・文脈収集・ナレッジ等
├── shared/
│   ├── types.ts                   # 共有型定義
│   └── messages.ts                # Webview メッセージ定義
└── views/
    ├── NavigatorViewProvider.ts   # WebviewView プロバイダー
    ├── screens/                   # 各画面コンポーネント (s01〜s08)
    └── webview/                   # Webview エントリ・状態管理
```

---

## 前提条件

- **VS Code Desktop** 1.99 以上（`vscode.dev` 等の Web 版は非対応）
- GitHub Copilot を利用する場合は、VS Code で GitHub にサインインし、Copilot の AI 機能を有効にしていること
  - [Copilot Free](https://docs.github.com/en/copilot/concepts/billing/individual-plans) でも月次上限の範囲で利用できます
  - 認証済みの学生は [Copilot Student](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/enable-copilot/set-up-for-students) を無料で利用できます
- LM Studio を利用する場合は、LM Studio と対象モデルをローカルで起動していること
- OrcaRouter を利用する場合は、[OrcaRouterの紹介リンク](https://www.orcarouter.ai/ref/ref_ca9caab6221888bc490e)から発行した `sk-orca-` 形式のAPIキー
- Node.js / npm

---

## セットアップと起動

### 依存パッケージのインストール

```bash
npm install
```

### ビルドして拡張機能を起動（F5）

```bash
npm run compile
```

ビルド完了後、VS Code で **F5** キーを押すか、実行とデバッグパネルから **Run Extension** を選択します。  
新しい Extension Development Host ウィンドウが起動し、アクティビティバーに NaviCom アイコンが表示されます。

### ウォッチモードでの開発

TypeScript の変更を都度コンパイルする場合は、2つのターミナルでそれぞれ起動します。

```bash
# ターミナル1: 拡張機能ホスト
npm run watch

# ターミナル2: Webview
npm run watch:webview
```

その後、実行とデバッグパネルから **Watch Extension** を選択して起動します。

### 初回接続

拡張機能を起動したら、サイドバーの NaviCom パネルを開き、使用する接続先を選びます。

- **Copilot に接続**: GitHub Copilot の認可ダイアログを許可します。
- **ローカル LLM に接続**: LM Studioでモデルをロードし、ローカルサーバーへ接続します。
- **OrcaRouter に接続**: APIキー未設定の場合は設定画面へ移動し、キー入力の案内を表示します。

### OrcaRouterの設定

1. 設定画面の「接続先」で **OrcaRouter** を選択します。
2. `sk-orca-` で始まるAPIキーを入力し、「キーを保存」を押します。保存後、モデル一覧が自動取得されます。
3. APIキー保存後に表示されるモデルから、初回の無課金動作確認には **Free Router (`orcarouter/free`)** を選択します。
4. 必要に応じて「モデル一覧を更新」で最新のテキストモデルを再取得します。
5. モデルを変更した場合は画面下部の「保存」を、変更していない場合は「OrcaRouterに接続」を押します。

APIキーはVS CodeのSecretStorageへ保存され、設定データや会話履歴には書き込まれません。保存済みキーの値は設定画面へ再表示されず、推論時にはSecretStorageから最新のキーを取得します。`orcarouter/free` は無料容量だけを利用し、容量がない場合も有料モデルへ自動移行しません。

### OrcaRouter利用時のデータ送信

OrcaRouterを選択すると、回答生成や会話タイトル・ナレッジ作成などに使うプロンプトがOrcaRouterと選択された上流モデル事業者へ送信されます。プロンプトには、処理に応じて次の情報が含まれます。

- 質問、追加コンテキスト、必要な会話内容
- 送信対象のコード断片、診断情報、ファイル名、ディレクトリ構造、関連シンボル、直近の編集情報
- 再利用する個人ナレッジのタイトル・要約と、回答改善に使うフィードバック傾向

保護済みまたは追加の除外パターンに一致するファイル本文は送信対象から除外されます。APIキーはプロンプトに含めず、VS CodeのSecretStorageからOrcaRouterへの認証にだけ使用します。利用前に[OrcaRouterのData Handling](https://docs.orcarouter.ai/operations/data-handling)と、利用する上流モデル事業者の規約を確認してください。

### OrcaRouterのGuardrail／Firewall

NaviComはOrcaRouterのGuardrail／Firewallを自動的に有効化・設定しません。[GuardrailをAPIキーへ適用](https://docs.orcarouter.ai/security/guardrails/attach-to-key)するか、OrcaRouter側でワークスペース既定のポリシーを設定した場合に、プロンプトや応答が検査されます。ポリシー未設定の状態で、NaviComから同じ推論エンドポイントを使うだけでは自動適用されません。

現在のNaviCom連携は通常のChat Completionsとしてテキストだけを送り、ツール定義やツール呼び出しを送信・実行しません。このため、[Agent Firewall](https://docs.orcarouter.ai/security/concepts/guardrails-vs-firewall)のツール実行制御は現在の連携経路では利用しません。Guardrailにより個別のリクエストが拒否された場合は、その旨を表示し、OrcaRouterとの接続自体は維持します。

### OrcaRouterの料金表示

応答の `usage.cost_usd` は「応答時点の記録料金」として表示します。この値は応答生成時に計算された情報であり、確定請求額とは限りません。確定した請求情報はOrcaRouter側の利用履歴、または[`GET /v1/generation`](https://docs.orcarouter.ai/operations/per-request-cost)で確認してください。`usage.cost_usd` がない応答や過去データは、NaviComの参考料金概算を表示します。

## 商標について

GitHubおよびGitHub CopilotはGitHub, Inc.の商標です。LM StudioはElement Labs, Inc.の商標です。OrcaRouterは各権利者に帰属する商標です。NaviComはこれら各社が開発、承認、後援する公式製品ではありません。プロバイダーのブランドアセットは、対応する接続先を識別する目的に限って使用しています。
