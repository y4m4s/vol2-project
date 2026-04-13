# 01. 概要

- 文書種別: 仕様書ドラフト
- 対象: VS Code Extension v1
- 作成日: 2026-04-13
- ステータス: 要件整理版

## 概要

本プロダクトは、VS Code 上で動作する「ペアプログラミングのナビゲーター役」を担う AI 拡張機能である。  
目的は、ユーザーの学習支援であり、回答や実装を代行することではない。AI はユーザーの作業文脈を踏まえつつ、考え方、切り分け方、確認ポイント、次に見るべき箇所を提案する。

v1 では `GitHub Copilot + VS Code Language Model API` を利用し、ユーザー自身の Copilot 利用権限の範囲で AI 応答を提供する。  
ナレッジ保存はローカルの `SQLite` を使用し、個人利用を前提とする。

## コンセプト

- ペアプログラミングのナビゲーターを AI にやらせる
- ユーザーの学習を支援する
- 答えを代行するのではなく、考え方・観点・詰まりの整理を補助する
- AI は提案までに留め、コード変更やコマンド実行等は行わない

## 目的

- 学習体験を高める
- 詰まったときの自己解決を支援する
- プロジェクト文脈を踏まえた助言を返す
- 詰まりや学びを個人ナレッジとして蓄積し、次回以降に再利用できるようにする

## 対象環境

- 対応環境: `VS Code Desktop`
- 非対応環境: `vscode.dev` / `github.dev` などの Web 版
- AI 利用基盤: `GitHub Copilot`
- AI 呼び出し方式: `VS Code Language Model API`
- ローカル LLM: v1 では対象外

## 技術スタック

### 使用技術

- TypeScript
- HTML
- CSS
- React
- VS Code Extension API
- WebviewView
- Language Model API
- SQLite

### モデル利用方針

- 初期実装では `GitHub Copilot` をモデル提供基盤として利用する
- 拡張機能から `VS Code Language Model API` 経由でモデルを呼び出す
- `OpenAI official JavaScript SDK` を直接利用する構成は v1 では採用しない
- 将来的に他モデルプロバイダへ差し替え・追加可能な構成を目指す

## スコープ

### 初期スコープ

- `GitHub Copilot + VS Code Language Model API` を利用した AI 応答
- 横ウィンドウでの対話 UI
- 初回接続フロー
- リアルタイムまたは準リアルタイムのフィードバック
- 常時モードと必要時モードの切り替え
- プロジェクト文脈を踏まえた回答
- 個人用ナレッジの蓄積と再利用

### 初期スコープ外

- ローカル LLM の利用
- チーム共有ナレッジ
- 他者との同期
- AI によるコード変更、自動実行、ターミナル操作
- Web 版 VS Code 対応
