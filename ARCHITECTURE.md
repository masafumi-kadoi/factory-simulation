# Factory Simulation - アーキテクチャ設計書

## 目次

1. [概要](#概要)
2. [インターロック機構](#インターロック機構)
3. [ステーション設計](#ステーション設計)
4. [シミュレーションエンジン](#シミュレーションエンジン)
5. [データモデル](#データモデル)
6. [今後の拡張性](#今後の拡張性)

---

## 概要

Factory Simulationは、工場の生産ラインにおけるワークフローを**インターロック制御方式**でシミュレーションするシステムです。実際の製造現場で使用される搬送制御の仕組みをソフトウェアで再現しています。

### 設計原則

1. **1ステーション1ワーク**: 各ステーションは同時に1つのワークのみ保持
2. **インターロック制御**: 搬入可・搬出可の2信号による厳密な制御
3. **逐次処理**: ワークは並列処理されず、順番に処理
4. **イベント駆動**: 離散イベントシミュレーションによる高速実行

---

## インターロック機構

### 基本概念

インターロック機構は、複数のステーション間でワークの移動を安全に行うための制御方式です。送出側と受入側の双方が準備完了状態になって初めて、ワークの移動が可能になります。

### 2信号制御

各ステーションは2つの信号を持ちます：

```
搬入可 (InputReady)  : ステーションがワークを受け入れ可能かどうか
搬出可 (OutputReady) : ステーションがワークを送出可能かどうか
```

### 信号の状態遷移

| ステーション状態 | 搬入可 | 搬出可 | 説明 |
|------------------|--------|--------|------|
| **Idle** | ON | OFF | ワーク無し、受入可能 |
| **Receiving** | OFF | OFF | ワーク受入中（遷移状態） |
| **Processing** | OFF | OFF | ワーク処理中 |
| **Completed** | OFF | ON | 処理完了、送出可能 |

### ワーク移動の条件

ワークが移動するためには、以下の条件を**すべて**満たす必要があります：

```
1. 送出側ステーションの「搬出可」= ON
2. 受入側ステーションの「搬入可」= ON
3. 両ステーション間に接続が定義されている
```

この条件により、以下が保証されます：
- ワークの同時流入の防止
- 処理中ステーションへの干渉防止
- デッドロックの防止

### 10信号インターロックモデル

現在の実装は10信号モデルを採用しています。信号の状態からインターロックルールにより制御信号が導出されます。

| 信号名 | 略称 | 種別 | 説明 |
|--------|------|------|------|
| `inputWorkPresent` | IWP | 状態 | ワークが搬入位置にある（加工未開始） |
| `processingWorkPresent` | PWP | 状態 | ワークが加工位置にある（加工中） |
| `outputWorkPresent` | OWP | 状態 | ワークが搬出位置にある（搬出待ち） |
| `running` | RUN | 状態 | 加工実行中 |
| `complete` | CPL | 状態 | 加工完了 |
| `processReady` | PR | 制御 | 加工開始可 |
| `inputReady` | IR | 制御 | 搬入可 |
| `outputReady` | OR | 制御 | 搬出可 |
| `workFull` | WF | タイマー | ワーク滞留 |
| `workEmpty` | WE | タイマー | ワーク枯渇 |

ワーク搬送は**ハンドシェイク方式**で制御されます：
- 上流の `outputReady=ON` かつ 下流の `inputReady=ON` が同時に成立した時のみ搬送開始
- `checkHandshakes()` がインデックス化された接続マップを使って O(degree) で判定

詳細は [SIMULATION-ENGINE.md](SIMULATION-ENGINE.md) を参照してください。

---

## ステーション設計

### 実装済みステーション（8種類）

| 種別 | 型名 | 役割 |
|------|------|------|
| Source | `source` | ワーク生成 |
| Processing | `processing` | 搬入・加工・搬出 |
| Drain | `drain` | ワーク消滅 |
| Merge | `merge` | 複数ワークを1つに結合 |
| Split | `split` | 1つのワークを複数に分割 |
| Entry | `entry` | Moduler内部の透過入口 |
| Exit | `exit` | Moduler内部の透過出口 |
| Moduler | `moduler` | 内部にサブシナリオを持つ複合ステーション |

#### 1. Source Station（ワーク生成）

**役割**: 指定個数のワークを逐次生成

**特徴**:
- 外部からワークを受け入れない
- 1つずつ順番にワークを生成
- `departureTime` 後に次のワーク生成をスケジュール

**設定パラメータ**:
```json
{
  "workCount": 10,        // 生成するワーク総数
  "departureTime": 2.0    // ワーク送出間隔（秒）
}
```

**状態遷移**:
```
Idle → WorkCreated → Completed → WorkDeparted → (次のワーク生成) → Idle
```

#### 2. Processing Station（処理・基底クラス）

**役割**: 1つのワークを受け取り、処理して送出

**特徴**:
- インターロック制御の基本形
- 処理中は次のワークを受け入れない
- 他のステーション種別の基底クラス

**設定パラメータ**:
```json
{
  "processingTime": 5.0,  // 処理時間（秒）
  "arrivalTime": 1.0,     // ワーク受入にかかる時間
  "departureTime": 1.0    // ワーク送出にかかる時間
}
```

**状態遷移**:
```
Idle → Receiving → Processing → Completed → Idle
```

**処理サイクル時間**:
```
サイクル時間 = arrivalTime + processingTime + departureTime
```

この時間より短い間隔でワークが到着すると、インターロック違反が発生します。

#### 3. Drain Station（ワーク消滅）

**役割**: ワークを破棄してシミュレーションから除去

**特徴**:
- 処理時間なし（即座に破棄）
- 終端ステーション

**設定パラメータ**:
```json
{
  "arrivalTime": 1.0     // ワーク受入にかかる時間
}
```

#### 4. Merge Station（結合）

**役割**: 複数の入力ポートからワークを受け取り、1つの結合ワークを生成

```
Work-A ──→ InPorts[1] ─┐
                        │  ┌────────┐
Work-B ──→ InPorts[2] ──┼─→│ Merge  │──→ 下流へ
                        │  └────────┘
Work-C ──→ InPorts[3] ─┘
```

**設定パラメータ**:
```json
{
  "processingTime": 3.0,
  "arrivalTime": 1.0,
  "departureTime": 1.0,
  "mergeInputCount": 2,
  "workType": "assembledPart"
}
```

**特徴**:
- 2層インターロック（ポートレベル + ステーションレベル）
- 全入力ポートが満杯になると結合処理を開始
- 結合後のワークに `mergedFrom` メタデータを付与（トレーサビリティ）

#### 5. Split Station（分割）

**役割**: 1つのワークを複数の出力ポートに分割

```
                  ┌─→ OutPorts[1] ──→ 下流A
Work ─→ Split ──┤
                  └─→ OutPorts[2] ──→ 下流B
```

**設定パラメータ**:
```json
{
  "processingTime": 2.0,
  "arrivalTime": 1.0,
  "departureTime": 1.0,
  "splitOutputCount": 2,
  "splitWorkTypes": ["partA", "partB"]
}
```

**特徴**:
- 2層インターロック（ステーションレベル + ポートレベル）
- 分割後のワークに `splitFrom` メタデータを付与（トレーサビリティ）
- ワーク種別ルーティング（`workType:<type>` 条件）に対応

#### 6. Entry Station（モジュラー入口）

**役割**: Moduler内部の透過入口。加工時間なしで即通過

**特徴**: 処理時間0、WorkArrived → 即StateCompleted → OutputReady=ON → WorkDeparted

#### 7. Exit Station（モジュラー出口）

**役割**: Moduler内部の透過出口。Entry と同一の動作

#### 8. Moduler Station（複合ステーション）

**役割**: 内部にサブシナリオ（Entry/Processing/Exit等）を持つ複合ステーション

```
┌───────────── Moduler ─────────────┐
│                                    │
│  Entry ──→ Processing ──→ Exit    │
│                                    │
│  Work: なし (信号導出用)            │
└────────────────────────────────────┘
```

**特徴**:
- シミュレーション実行時に `FlattenScenario()` でフラットに展開
- 内部ステーションIDは「親ID.子ID」形式にプレフィックス付与（例: `moduler-1.proc-1`）
- 親Modulerの信号は内部ステーションの状態から自動導出（`deriveModulerSignals()`）
- ネストに対応（Moduler内にModulerを配置可能）
- `stationModulerMap` によるO(1)の親Moduler検索

---

## シミュレーションエンジン

### 離散イベントシミュレーション

Factory Simulationは**離散イベントシミュレーション**方式を採用しています。

**特徴**:
- 時間を連続的に進めるのではなく、イベントが発生する時刻にジャンプ
- 高速なシミュレーション実行が可能
- イベント間の無駄な計算を省略

### イベント種別

| イベント | 説明 | 発生条件 |
|----------|------|----------|
| **WorkCreated** | ワーク生成 | Sourceステーション |
| **WorkArrived** | ワーク到着 | 移動時間経過後 |
| **ProcessingStarted** | 処理開始 | ワーク到着 + processReady=ON |
| **ProcessingCompleted** | 処理完了 | 処理時間経過後 |
| **WorkDeparted** | ワーク出発 | ハンドシェイク成立（OR=ON & IR=ON） |
| **WorkDestroyed** | ワーク破棄 | Drainステーション到着 |
| **WorkMerged** | ワーク結合 | Mergeで全ポート満杯後の結合完了 |
| **WorkSplit** | ワーク分割 | Splitでの分割完了 |
| **MergeCompleted** | 結合処理完了 | Mergeの処理時間経過後 |
| **SplitCompleted** | 分割処理完了 | Splitの処理時間経過後 |
| **CheckWorkFull** | 滞留チェック | stayTime経過後 |
| **CheckWorkEmpty** | 枯渇チェック | noWorkTimeout経過後 |

### イベントループ

```go
func (e *Engine) Run(simulationID, friendlyName string, timeLimit float64) (*domain.Simulation, []StationStatusLog, []WorkEventLog, []WorkLineageLog, error) {
    // Step 0: Flatten ModulerStations + build indexes
    e.scenario = FlattenScenario(e.scenario)
    e.scenario.BuildStationIndex()          // O(1) station/connection lookup
    e.stationModulerMap = e.scenario.StationModulerMap

    // Step 1: Initialize interlock rules, signals, ports
    // Step 2: Evaluate initial signals
    // Step 3: Place initial works
    // Step 4: Schedule first WorkCreated for each Source

    // Event loop
    for !e.eventQueue.IsEmpty() {
        event := e.eventQueue.Pop()
        e.currentTime = event.Time
        if e.currentTime > timeLimit { break }
        e.processEvent(event, simulation)
    }

    return simulation, e.statusLogs, e.workEventLogs, e.workLineageLogs, nil
}
```

### 優先度キュー

イベントは時刻順に処理されます：

```go
type Event struct {
    Type      EventType
    Time      float64    // Event timestamp
    StationID string
    WorkID    *string
    PortIndex int        // Port slot index (-1 = no port, used for Merge/Split)
}
```

### Sourceステーションの逐次ワーク生成

**仕組み**:

1. 初期化時に各Sourceの最初のワーク生成をスケジュール
2. ワークが出発したら、次のワーク生成をスケジュール
3. 指定個数に達するまで繰り返し

```go
// handleWorkDeparted handles the WorkDeparted event
func (e *Engine) handleWorkDeparted(event *Event, station *domain.Station) error {
    // ... ワークを送出 ...

    // For Source stations: Schedule next work creation (interlock: one at a time)
    if station.Type == domain.StationTypeSource {
        workCount := station.GetIntConfig("workCount")
        if e.sourceWorkCounters[station.ID] < workCount {
            // Create next work after configured departure time (interlock delay)
            departureTime := station.GetFloatConfig("departureTime")
            e.eventQueue.Push(NewEvent(EventWorkCreated, e.currentTime+departureTime, station.ID, nil))
        }
    }

    return nil
}
```

これにより、1ステーション1ワークの原則が保証されます。

---

## データモデル

### ER図

```
scenarios
    ├─ id (PK)
    ├─ name
    ├─ simdb_host, simdb_port, simdb_database, simdb_user, simdb_password
    ├─ created_at
    └─ updated_at

scenario_stations
    ├─ id (PK)
    ├─ scenario_id (FK)
    ├─ station_id
    ├─ station_type (source|processing|drain|merge|split|entry|exit|moduler)
    ├─ parent_id (Moduler内部ステーション用)
    ├─ config (JSONB)
    ├─ location_id (SimDB連携)
    ├─ position_x, position_y (エディタ座標)
    └─ name

scenario_connections
    ├─ id (PK)
    ├─ scenario_id (FK)
    ├─ from_station, to_station
    ├─ condition (default|quality_ok|quality_ng|workType:xxx)
    └─ from_port_index, to_port_index (Merge/Splitポート指定, -1=なし)

simulation_runs
    ├─ id (PK)
    ├─ scenario_id (FK)
    ├─ friendly_name
    ├─ status (running|completed|failed)
    ├─ start_time, end_time, simulation_end_time
    ├─ end_reason (time_limit|event_exhausted)
    └─ created_at

work_events
    ├─ id (PK)
    ├─ simulation_run_id (FK)
    ├─ work_id, work_friendly_name
    ├─ station_id
    ├─ timestamp, event_type
    ├─ work_type
    └─ port_index (-1=なし)

station_status_logs
    ├─ id (PK)
    ├─ simulation_run_id (FK)
    ├─ station_id
    ├─ timestamp, status_type, value
    ├─ signal_name, old_value, rule_id (signal_change用)

work_lineage
    ├─ id (PK)
    ├─ simulation_run_id (FK)
    ├─ child_work_id, child_work_friendly_name
    ├─ parent_work_id, parent_work_friendly_name
    ├─ operation_type (merge|split)
    ├─ station_id, timestamp
    └─ created_at

execution_configs
    ├─ id (PK)
    ├─ scenario_id (FK)
    ├─ start_time
    ├─ end_condition_type, end_condition_value
    ├─ initial_conditions (JSONB)
    ├─ status, simulation_id, error_message
    └─ created_at, updated_at
```

マイグレーションファイル: `database/migrations/` に001〜010の10ファイル。

### シナリオデータ構造（JSONB）

```json
{
  "name": "シナリオ名",
  "stations": [
    {
      "id": "station-1",
      "type": "source|processing|drain|merge|split|entry|exit|moduler",
      "config": {
        "workCount": 10,
        "processingTime": 5.0,
        "arrivalTime": 1.0,
        "departureTime": 1.0
      }
    }
  ],
  "connections": [
    {
      "from": "station-1",
      "to": "station-2",
      "condition": "default|quality_ok|quality_ng|workType:xxx",
      "fromPortIndex": -1,
      "toPortIndex": -1
    }
  ]
}
```

---

## 今後の拡張性

### 実装済み機能

以下は設計段階から実装済みとなった機能：

- **Merge/Split Station**: 2層インターロック、ポートレベル制御、トレーサビリティ
- **Entry/Exit/Moduler Station**: サブシナリオのフラット展開、ネスト対応
- **ワーク種別ルーティング**: `workType:<type>` 条件による分岐
- **タイマー信号**: `workFull`/`workEmpty` による滞留・枯渇検出
- **SimDB連携**: 外部生産データベースからの初期条件取得
- **インデックス最適化**: ステーション/接続のO(1)ルックアップ、`stationModulerMap`

### 拡張候補

1. **Inspection/Discharge Station**
   - 品質ステータス判定とOK/NG条件ルーティング

2. **リアルタイムシミュレーション**
   - WebSocketによるライブ更新

3. **パフォーマンス分析**
   - ボトルネック検出、稼働率計算、サイクルタイム分析

4. **高度な可視化**
   - 2Dガントチャート、統計ダッシュボード

---

## 設計上の考慮事項

### パフォーマンス

- **イベント駆動**: O(log N) の優先度キューで高速処理
- **メモリ効率**: 1ステーション1ワークで省メモリ
- **Go言語**: ガベージコレクション + 並行処理対応

### 拡張性

- **Processingステーション基底**: 継承による機能追加
- **JSONB設定**: スキーマレスな柔軟性
- **プラグイン可能**: 新しいステーション種別の追加が容易

### テスタビリティ

- **ユニットテスト**: 各ステーションの独立テスト
- **統合テスト**: シナリオベースの自動テスト
- **決定論的**: 乱数シードで再現可能

### 保守性

- **明確な責務分離**: Domain / Simulation / API
- **インターフェース**: 疎結合な設計
- **ドキュメント**: コメント + 外部ドキュメント

---

## 参考文献

- `README.md` - システム概要
- `TESTING.md` - テスト・動作確認ガイド
- `simulation-core/internal/domain/station.go` - ステーション実装
- `simulation-core/internal/simulation/engine.go` - エンジン実装
