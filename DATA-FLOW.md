# Factory Simulation - データ構成・通信フロー

## 概要

Factory Simulationは7つのサービスで構成され、データは「シナリオ定義（StaticParameter）」と「実行条件（DynamicParameter）」の2種類に大別されます。

本ドキュメントでは、各データがどこに保管され、どのサービス間でどのように受け渡されるかを整理します。

---

## データの分類

### StaticParameter（シナリオ定義）

シミュレーションの構造を定義する静的なパラメータ。sim-editorで作成・編集する。

| データ | 説明 | DB格納先 |
|--------|------|---------|
| シナリオ名 | シナリオの表示名 | `scenarios.name` |
| ステーション定義 | type, config (処理時間等) | `scenario_stations` |
| 接続定義 | from/to, condition | `scenario_connections` |
| SimDB接続情報 | host, port, database, user, password | `scenarios.simdb_*` |
| Location紐付け | ステーションとSimDB LocationMasterの対応 | `scenario_stations.location_id` |

### DynamicParameter（実行条件）

シミュレーション実行時に指定する動的なパラメータ。sim-executorで設定する。

| データ | 説明 | DB格納先 |
|--------|------|---------|
| 開始日時 | シミュレーションの開始時刻 | `execution_configs.start_time` |
| 終了条件 | duration（分）/ absolute（日時） | `execution_configs.end_condition_type/value` |
| 初期条件 | 各ステーションの初期ワーク配置 | `execution_configs.initial_conditions` (JSONB) |
| 実行ステータス | pending / running / completed / error | `execution_configs.status` |

### シミュレーション結果

simulation-coreが生成する実行結果データ。

| データ | 説明 | DB格納先 |
|--------|------|---------|
| 実行サマリー | ステータス, 終了時刻, 終了理由 | `simulation_runs` |
| ステーション状態ログ | 各ステーションの信号変化 | `station_status_logs` |
| ワークイベント | ワークのライフサイクルイベント | `work_events` |
| ワーク系譜 | Merge/Split時の親子関係 | `work_lineage` |

---

## データベーススキーマ

### ER図（テキスト表現）

```
scenarios
├── scenario_stations        (1:N)
├── scenario_connections     (1:N)
├── simulation_runs          (1:N, FK制約なし)
│   ├── station_status_logs  (1:N)
│   ├── work_events          (1:N)
│   └── work_lineage         (1:N)
└── execution_configs        (1:N, FK制約なし)
```

### テーブル定義

#### scenarios（シナリオ定義）

管理: simulation-core

| カラム | 型 | 説明 |
|--------|-----|------|
| id | VARCHAR(255) PK | シナリオID (UUID) |
| name | VARCHAR(255) | シナリオ名 |
| created_at | TIMESTAMP | 作成日時 |
| simdb_host | VARCHAR(255) | SimDB接続先ホスト |
| simdb_port | INTEGER | SimDBポート (default: 5432) |
| simdb_database | VARCHAR(255) | SimDBデータベース名 |
| simdb_user | VARCHAR(255) | SimDBユーザー名 |
| simdb_password | VARCHAR(255) | SimDBパスワード |

#### scenario_stations（ステーション定義）

管理: simulation-core

| カラム | 型 | 説明 |
|--------|-----|------|
| id | SERIAL PK | 連番 |
| scenario_id | VARCHAR(255) FK | シナリオID |
| station_id | VARCHAR(255) | ステーションID (例: "source-1") |
| station_type | VARCHAR(50) | 種別 (source / processing / drain) |
| parent_id | VARCHAR(255) | 親ステーションID (将来用) |
| location_id | BIGINT | SimDB LocationMasterのID |
| config | JSONB | ステーション固有設定 |

**config JSONB の例:**
```json
// source
{"workCount": 3, "departureTime": 5.0}

// processing
{"processingTime": 2.0, "arrivalTime": 1.0, "departureTime": 1.0}

// drain
{"arrivalTime": 1.0}
```

#### scenario_connections（接続定義）

管理: simulation-core

| カラム | 型 | 説明 |
|--------|-----|------|
| id | SERIAL PK | 連番 |
| scenario_id | VARCHAR(255) FK | シナリオID |
| from_station | VARCHAR(255) | 接続元ステーションID |
| to_station | VARCHAR(255) | 接続先ステーションID |
| condition | VARCHAR(50) | 経路条件 (default / quality_ok / quality_ng) |

#### execution_configs（実行設定・履歴）

管理: sim-executor-backend

| カラム | 型 | 説明 |
|--------|-----|------|
| id | VARCHAR(36) PK | 実行ID (UUID) |
| scenario_id | VARCHAR(255) | 対象シナリオID |
| start_time | TIMESTAMP | シミュレーション開始日時 |
| end_condition_type | VARCHAR(20) | 終了条件種別 (duration / absolute) |
| end_condition_value | VARCHAR(50) | 終了条件値 (分数 or ISO 8601) |
| initial_conditions | JSONB | 初期条件 (各ステーションのワーク配置) |
| status | VARCHAR(20) | 実行状態 (pending / running / completed / error) |
| simulation_id | VARCHAR(255) | simulation-coreのシミュレーションID |
| error_message | TEXT | エラー詳細 |
| created_at | TIMESTAMP | 作成日時 |
| updated_at | TIMESTAMP | 更新日時 |

#### simulation_runs（シミュレーション実行結果）

管理: simulation-core

| カラム | 型 | 説明 |
|--------|-----|------|
| id | VARCHAR(255) PK | シミュレーションID (UUID) |
| scenario_id | VARCHAR(255) | シナリオID |
| friendly_name | VARCHAR(255) | 表示名 |
| start_time | TIMESTAMP | 開始時刻 |
| end_time | TIMESTAMP | 終了時刻 |
| simulation_end_time | FLOAT | シミュレーション終了時間（秒） |
| end_reason | VARCHAR(50) | 終了理由 (event_exhausted / time_limit) |
| status | VARCHAR(50) | ステータス (completed / failed) |
| created_at | TIMESTAMP | 作成日時 |

#### station_status_logs / work_events / work_lineage

simulation-coreが生成するログデータ。詳細はTESTING.mdを参照。

---

## サービス間通信フロー

### 全体構成図

```
┌─────────────┐  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐
│ sim-portal  │  │ sim-editor   │  │ sim-executor  │  │ sim-visualizer  │
│ :8085       │  │ :8082        │  │ :8083         │  │ :8081           │
│ (Frontend)  │  │ (Frontend)   │  │ (Frontend)    │  │ (Frontend)      │
└──────┬──────┘  └──────┬───────┘  └───────┬───────┘  └────────┬────────┘
       │                │                   │                    │
       │                │                   │                    │
       ▼                ▼                   ▼                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Browser (JavaScript fetch)                       │
└──────────┬───────────────────────────┬───────────────────────────────┘
           │                           │
           ▼                           ▼
┌─────────────────────┐  ┌──────────────────────────┐
│  simulation-core    │  │  sim-executor-backend    │
│  :8080              │  │  :8084                   │
│                     │  │                          │
│  - scenarios        │  │  - execution_configs     │
│  - simulations      │◄─│  - SimDB連携             │
│  - logs             │  │                          │
└─────────┬───────────┘  └────────────┬─────────────┘
          │                           │
          ▼                           ▼
┌─────────────────────┐  ┌──────────────────────────┐
│  PostgreSQL         │  │  SimDB (外部DB)          │
│  :5432              │  │  製造ライン毎に異なる    │
│  factory_simulation │  │                          │
└─────────────────────┘  └──────────────────────────┘
```

### 通信パターン

#### 1. シナリオの作成・編集 (StaticParameter)

```
sim-editor ──POST /api/scenarios──> simulation-core ──INSERT──> PostgreSQL
                                                                 scenarios
                                                                 scenario_stations
                                                                 scenario_connections
```

#### 2. シナリオの閲覧

```
sim-portal ──GET──> sim-executor-backend ──GET /api/scenarios──> simulation-core
                    (executionCount追加)                          ──SELECT──> PostgreSQL

sim-executor ──GET──> sim-executor-backend (同上)
```

#### 3. SimDBからの初期条件取得 (DynamicParameter)

```
sim-executor
  ──POST /api/executor/initial-conditions──> sim-executor-backend
                                              ──GET scenario──> simulation-core (simdbConfig取得)
                                              ──SELECT──> SimDB (LocationMaster, ActionInfo)
                                              ◄── initialConditions + warnings
```

#### 4. シミュレーション実行

```
sim-executor
  ──POST /api/executor/execute──> sim-executor-backend
                                   ──INSERT──> execution_configs (DynamicParameter保存)
                                   ──POST /api/simulations──> simulation-core
                                                               ──INSERT──> simulation_runs
                                                               ──INSERT──> work_events, etc.
                                   ◄── executionId + simulationId
```

#### 5. 結果の可視化

```
sim-visualizer ──GET /api/simulations/{id}/logs──> simulation-core
                                                    ──SELECT──> work_events
                                                    ──SELECT──> station_status_logs
```

---

## URLパラメータ規約

各フロントエンド間のリンクで使用するURLパラメータ。

### sim-editor

| パラメータ | 用途 | 例 |
|-----------|------|-----|
| `id` | localStorage シナリオ (sim-editor内部用) | `editor.html?id=local-123` |
| `scenarioId` | API シナリオ (外部ツールからの遷移) | `editor.html?scenarioId=uuid-xxx` |

両方未指定の場合はエラー。`id`が優先される。

### sim-executor

| ページ | パラメータ | 用途 |
|--------|-----------|------|
| `scenario.html` | `id` | シナリオ詳細表示 |
| `execution.html` | `scenarioId` | 実行設定画面 |

### sim-visualizer

| パラメータ | 用途 | 例 |
|-----------|------|-----|
| `sim` | シミュレーション結果の3D表示 | `index.html?sim=uuid-xxx` |

### ツール間リンク

| リンク元 | リンク先 | URL形式 |
|---------|---------|---------|
| sim-executor → sim-editor | `http://localhost:8082/editor.html?scenarioId={id}` |
| sim-portal → sim-editor | `http://localhost:8082/editor.html?scenarioId={id}` |
| sim-portal → sim-executor | `http://localhost:8083/scenario.html?id={id}` |
| sim-executor → sim-visualizer | `http://localhost:8081/?sim={simulationId}` |

---

## API エンドポイント一覧

### simulation-core (ポート 8080)

StaticParameter と シミュレーション結果を管理。

| エンドポイント | メソッド | 入力 | 出力 | 用途 |
|---------------|---------|------|------|------|
| `/api/scenarios` | POST | ScenarioRequest | `{scenarioId}` | シナリオ作成 |
| `/api/scenarios` | GET | - | `{scenarios: [...]}` | シナリオ一覧 |
| `/api/scenarios/{id}` | GET | - | ScenarioDetail | シナリオ詳細 (stations, connections含む) |
| `/api/simulations` | POST | SimulationRequest | SimulationResult | シミュレーション実行 |
| `/api/simulations` | GET | - | SimulationList | シミュレーション一覧 |
| `/api/simulations/{id}` | GET | - | SimulationResult | シミュレーション結果 |
| `/api/simulations/{id}/logs` | GET | - | LogsResponse | イベントログ |

### sim-executor-backend (ポート 8084)

DynamicParameter の管理と、simulation-coreへの実行委譲。

| エンドポイント | メソッド | 入力 | 出力 | 用途 |
|---------------|---------|------|------|------|
| `/api/executor/scenarios` | GET | - | `{scenarios: [...]}` | シナリオ一覧 (executionCount付き) |
| `/api/executor/executions` | GET | `?scenarioId=` | `{executions: [...]}` | 実行履歴 |
| `/api/executor/execute` | POST | ExecuteRequest | `{executionId, simulationId, ...}` | 実行 |
| `/api/executor/initial-conditions` | POST | `{scenarioId, startTime}` | `{initialConditions, warnings}` | SimDB初期条件 |
| `/api/executor/simdb/test-connection` | POST | `{scenarioId}` | `{success, locations}` | SimDB接続テスト |

---

## データライフサイクル

```
1. sim-editor でシナリオ作成
   └─> scenarios, scenario_stations, scenario_connections に INSERT

2. sim-executor でシナリオ選択
   └─> sim-executor-backend 経由で scenarios を SELECT (executionCount付き)

3. sim-executor で実行条件設定
   ├─> [任意] SimDBから初期条件取得 (POST /initial-conditions)
   └─> 開始日時・終了条件・初期条件を設定

4. sim-executor で実行
   ├─> execution_configs に INSERT (DynamicParameter保存)
   ├─> simulation-core に POST /simulations (実行委譲)
   └─> simulation_runs, work_events, station_status_logs に INSERT (結果保存)

5. sim-visualizer で結果確認
   └─> simulation_runs, work_events を SELECT して3Dアニメーション

6. sim-portal で全体管理
   ├─> scenarios + executionCount で一覧表示
   ├─> execution_configs で実行履歴表示
   └─> 各サービスのヘルスチェック
```

---

## 関連ドキュメント

- [README.md](README.md) - システム概要
- [TESTING.md](TESTING.md) - テスト・動作確認ガイド
- [ARCHITECTURE.md](ARCHITECTURE.md) - アーキテクチャ設計書

### 各サービスの通信フロー詳細

- [sim-portal/COMMUNICATION.md](sim-portal/COMMUNICATION.md) - ポータルの通信フロー
- [sim-editor/COMMUNICATION.md](sim-editor/COMMUNICATION.md) - エディタの通信フロー
- [sim-executor/COMMUNICATION.md](sim-executor/COMMUNICATION.md) - 実行管理の通信フロー
- [sim-visualizer/COMMUNICATION.md](sim-visualizer/COMMUNICATION.md) - 可視化の通信フロー
