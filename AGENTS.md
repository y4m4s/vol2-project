# AGENTS.md

- VS Code 拡張の Activity Bar / Webview が表示されない場合、まずコンパイルエラーだけでなく VS Code の永続 UI 状態も確認する。`workbench.activity.viewletsWorkspaceState`、`workbench.auxiliarybar.viewContainersWorkspaceState`、`workbench.view.extension.aiPairNavigator.state` に、NaviCom が別ペインへ移動済み・非表示として保存されていることがある。
- F5 の Extension Development Host でだけ起きる表示不具合は、`View: Reset View Locations`、または開発用の `--user-data-dir` で切り分ける。PC 再起動では保存済み view state は基本的に解消されない。
- AI で大きめの変更を入れた後でも、原因を「一括書き換え」と決め打ちしない。ログ、manifest contribution、ビルド結果、VS Code 側の保存状態を順に確認する。
