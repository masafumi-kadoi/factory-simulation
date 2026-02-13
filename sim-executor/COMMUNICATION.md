# sim-executor 通信フロー

## 概要

sim-executorはシミュレーション実行管理ツールです。フロントエンド(ポート8083)とバックエンドAPI(ポート8084)の2コンポーネントで構成されます。フロントエンドはsim-executor-backend APIのみを呼び出し、バックエンドがsimulation-coreへの委譲とSimDB連携を担います。

## 接続先

### フロントエンド (ポート 8083)

| 接続先 | ベースURL | 用途 |
|--------|----------|------|
| sim-executor-backend | `http://localhost:8084/api/executor` | 全API操作 |

### バックエンド (ポート 8084)

| 接続先 | URL | 用途 |
|--------|-----|------|
| simulation-core | `http://simulation-core:8080/api` | シナリオ取得・シミュレーション実行 |
| PostgreSQL | `postgres:5432` | execution_configs テーブル |
| SimDB | シナリオ毎に異なる | 初期条件取得 |

## ページ別通信フロー

### ダッシュボード (index.html / dashboard.js)

```
ページロード時:

1. シナリオ一覧取得
   GET http://localhost:8084/api/executor/scenarios
   → レスポンス: {scenarios: [{scenarioId, name, stationCount, connectionCount, executionCount, simdbConfig}]}
   → シナリオカード描画
```

**アクションリンク:**

| ボタン | リンク先 | パラメータ |
|--------|---------|-----------|
| Execution History | 内部 | `scenario.html?id={scenarioId}` |
| Edit in sim-editor | sim-editor | `http://localhost:8082/editor.html?scenarioId={id}` |

### シナリオ詳細 (scenario.html / scenario.js)

```
ページロード時（?id={scenarioId}）:

1. シナリオ情報取得
   GET http://localhost:8084/api/executor/scenarios
   → 全シナリオから該当IDをフィルタ
   → シナリオ名, ステーション数, SimDB設定を表示

2. 実行履歴取得
   GET http://localhost:8084/api/executor/executions?scenarioId={id}
   → レスポンス: {executions: [{id, scenarioId, startTime, endConditionType, endConditionValue, status, simulationId, createdAt}]}
   → 実行履歴テーブル描画
```

**アクションリンク:**

| ボタン | 条件 | リンク先 |
|--------|------|---------|
| New Execution | 常時 | `execution.html?scenarioId={id}` |
| View | status=completed | `http://localhost:8081/?simulationId={simulationId}` |
| Re-run | status=completed | `execution.html?scenarioId={id}&rerun={executionId}` |
| Retry | status=error | `execution.html?scenarioId={id}&rerun={executionId}` |
| Edit in sim-editor | 常時 | `http://localhost:8082/editor.html?scenarioId={id}` |

### 実行設定 (execution.html / execution.js)

```
ページロード時（?scenarioId={id}）:

1. シナリオ情報取得
   GET http://localhost:8084/api/executor/scenarios
   → シナリオ名, SimDB設定の表示
   → SimDB未設定の場合は「Fetch from SimDB」ボタンを非活性化
```

#### SimDBから初期条件取得

```
「Fetch from SimDB」ボタン押下時:

1. 初期条件取得
   POST http://localhost:8084/api/executor/initial-conditions
   → リクエスト:
     {
       scenarioId: "uuid",
       startTime: "2026-01-01T08:00:00"  (ISO 8601, TZなし)
     }

   [sim-executor-backend 内部処理]
   ├── GET /api/scenarios/{id} ──> simulation-core (simdbConfig + locationId取得)
   ├── SimDBに接続
   │   ├── SELECT * FROM ActionInfo WHERE start_time <= {startTime}
   │   └── SELECT * FROM ItemStatus
   └── 初期条件を構築

   → レスポンス:
     {
       initialConditions: {
         "station-1": {currentWork: {id: "W001", qualityStatus: "OK"}, elapsedTime: 30},
         "station-2": {currentWork: null}
       },
       warnings: [{stationId: "station-3", message: "No location mapping"}]
     }

2. 画面に初期条件テーブルを表示
   → Station | Work ID | Elapsed (sec) | Quality
   → 警告があればワーニングボックスを表示
```

#### シミュレーション実行

```
「Execute Simulation」ボタン押下時:

1. 実行リクエスト送信
   POST http://localhost:8084/api/executor/execute
   → リクエスト:
     {
       scenarioId: "uuid",
       startTime: "2026-01-01T08:00:00",
       endCondition: {
         type: "duration",    // or "absolute"
         value: "60"          // 分数 or ISO 8601
       },
       initialConditions: {   // Fetch from SimDBの結果、または空{}
         "station-1": {...}
       }
     }

   [sim-executor-backend 内部処理]
   ├── execution_configsにINSERT (DynamicParameter保存)
   ├── POST /api/simulations ──> simulation-core
   │   → {scenarioId, simulationTime, initialConditions}
   │   ← {simulationId, status, endTime, endReason}
   ├── execution_configsをUPDATE (simulationId, status)
   └── レスポンス返却

   → レスポンス:
     {
       executionId: "exec-uuid",
       simulationId: "sim-uuid",
       status: "completed",
       endReason: "event_exhausted"
     }

2. 結果パネルを表示
   → ステータス, 終了理由
   → 「View in sim-visualizer」リンク
   → 「Back to Scenario」リンク
```

## 通信シーケンス図（実行フロー全体）

```
sim-executor       sim-executor-       simulation-       PostgreSQL    SimDB
(Frontend)         backend             core              (factory_sim) (外部)
    │                 │                    │                  │           │
    │ GET /executor/  │                    │                  │           │
    │ scenarios       │                    │                  │           │
    │────────────────>│ GET /api/scenarios │                  │           │
    │                 │───────────────────>│ SELECT scenarios │           │
    │                 │                    │─────────────────>│           │
    │                 │                    │<─────────────────│           │
    │                 │<───────────────────│                  │           │
    │                 │ SELECT COUNT       │                  │           │
    │                 │ execution_configs  │                  │           │
    │                 │──────────────────────────────────────>│           │
    │                 │<──────────────────────────────────────│           │
    │<────────────────│ +executionCount    │                  │           │
    │                 │                    │                  │           │
    │ POST /executor/ │                    │                  │           │
    │ initial-conds   │                    │                  │           │
    │────────────────>│ GET /api/scenarios │                  │           │
    │                 │ /{id}             │                  │           │
    │                 │───────────────────>│ SELECT scenario  │           │
    │                 │                    │ + simdbConfig    │           │
    │                 │                    │─────────────────>│           │
    │                 │<───────────────────│                  │           │
    │                 │                    │                  │           │
    │                 │ SELECT ActionInfo, ItemStatus ────────────────── >│
    │                 │< ──────────────────────────────────────────────── │
    │<────────────────│ initialConditions  │                  │           │
    │                 │ + warnings         │                  │           │
    │                 │                    │                  │           │
    │ POST /executor/ │                    │                  │           │
    │ execute         │                    │                  │           │
    │────────────────>│ INSERT             │                  │           │
    │                 │ execution_configs  │                  │           │
    │                 │──────────────────────────────────────>│           │
    │                 │                    │                  │           │
    │                 │ POST /api/         │                  │           │
    │                 │ simulations        │                  │           │
    │                 │───────────────────>│ INSERT sim_runs  │           │
    │                 │                    │ + work_events    │           │
    │                 │                    │─────────────────>│           │
    │                 │<───────────────────│ simulationId     │           │
    │                 │                    │                  │           │
    │                 │ UPDATE             │                  │           │
    │                 │ execution_configs  │                  │           │
    │                 │──────────────────────────────────────>│           │
    │<────────────────│ executionId +      │                  │           │
    │                 │ simulationId       │                  │           │
    │                 │                    │                  │           │
    │ [View Result]   │                    │                  │           │
    │ → sim-visualizer│                    │                  │           │
    │   ?simulationId │                    │                  │           │
```
