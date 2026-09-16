# Context length characterization

同じ送信promptを4K/8K/16Kへ各2回。context設定以外のrequestは固定。形式修復なしの1回推論を測定。

| Allocated | Hard pass | Correctness | Groundedness | Median ms | Warm median ms | p95 ms | Decode t/s | Max load ms |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 4096 | 0.67 | 2.67 | 2.67 | 4532 | 4532 | 16220 | 14.1 | 34 |
| 8192 | 1.00 | 3.33 | 4.00 | 9187 | 6566 | 40647 | 10.9 | 10846 |
| 16384 | 1.00 | 3.00 | 3.33 | 11747 | 7955 | 28879 | 11.7 | 11455 |

Observed multidimensional Pareto frontier: 4096, 8192 tokens. 9軸の平均とwarm median latencyで非劣位点を列挙する。3課題のみ・cache非統制なので一般化しない。

## Findings

- 短文632 tokensと、同じ答えに不要なメモを足した3,992 tokensでは、全contextで17秒に正答。不要文脈は品質改善なし、prefill/cacheによって待ち時間が増える。
- applicationで最新仕様を失った長文は、4Kで処理済み2,050 tokens、8K/16Kで4,550 tokens。同一promptのhashで検証可能。拡大はJSON契約を回復したが、消えた最新17秒の情報を回復しない。
- 8Kは欠落を認める回答2/2、16Kは1/2で旧値を最新と推測。小標本のため16K自体を幻覚の原因と断定しない。
- このセットには4Kを超える全情報が必須の成功課題がない。実タスク全般での最適context値は未確定。まず送信前の情報保持を別評価し、必要情報量を測る。
