import { SCENARIOS } from "./fixtures";
import { formatReport, runStatic } from "./runner";

/**
 * 静的評価のエントリポイント。
 *
 *   npm run eval
 *
 * モデルを呼ばずに、組み立て済みプロンプトの性質だけを検査する（無料・即時・CI 可能）。
 * 失敗が 1 件でもあれば終了コード 1 を返すので、CI の歯止めに使える。
 */
function main(): void {
  const report = runStatic(SCENARIOS);
  // eslint-disable-next-line no-console
  console.log(formatReport(report));
  process.exit(report.failed > 0 ? 1 : 0);
}

main();
