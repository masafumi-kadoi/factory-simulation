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

### 実装例（Go）

```go
// station.go

// IsInputReady returns true if station can accept a new work (搬入可 signal)
func (s *Station) IsInputReady() bool {
    // Input ready only when station is idle (no work present)
    return s.State == StateIdle && s.CurrentWork == nil
}

// IsOutputReady returns true if station has completed work and ready to send (搬出可 signal)
func (s *Station) IsOutputReady() bool {
    // Output ready only when station has completed processing
    return s.State == StateCompleted && s.CurrentWork != nil
}
```

```go
// engine.go

// Check interlock: OutputReady must be ON (except for Source stations)
if station.Type != domain.StationTypeSource && !station.IsOutputReady() {
    return fmt.Errorf("interlock violation: station %s OutputReady=OFF (state=%s), cannot depart work", station.ID, station.State)
}

// Check interlock: Next station must have InputReady ON
if !nextStation.IsInputReady() {
    return fmt.Errorf("interlock violation: next station %s InputReady=OFF (state=%s), cannot send work", nextStation.ID, nextStation.State)
}
```

---

## ステーション設計

### 継承構造（今後の実装）

Processingステーションを基底クラスとし、他のステーションはこれを継承します：

```
BaseStation (interface)
    ↓
ProcessingStation (基底実装)
    ↓ 継承
    ├── MergeStation
    ├── SplitStation
    ├── InspectionStation
    └── DischargeStation
```

### 現在実装されているステーション

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

### 今後実装予定のステーション

#### Merge Station（統合）

**役割**: 複数のワークを1つに統合

```
Work-A ──┐
         ├─→ Merge ─→ Work-C (新規)
Work-B ──┘
```

**設定パラメータ**:
```json
{
  "requiredWorkCount": 2,  // 必要なワーク数
  "processingTime": 3.0,
  "arrivalTime": 1.0,
  "departureTime": 1.0
}
```

**課題**:
- 複数のワークを保持する必要がある（1ステーション1ワークの原則を拡張）
- 親ワークの追跡（トレーサビリティ）

#### Split Station（分割）

**役割**: 1つのワークを複数に分割

```
Work-A ─→ Split ──┬─→ Work-B (新規)
                  └─→ Work-C (新規)
```

**設定パラメータ**:
```json
{
  "outputWorkCount": 3,    // 出力ワーク数
  "processingTime": 2.0,
  "arrivalTime": 1.0,
  "departureTime": 1.0
}
```

**課題**:
- 複数のワークを順次送出する必要がある
- ラウンドロビンでの経路選択
- 子ワークの追跡（トレーサビリティ）

#### Inspection Station（検査）

**役割**: ワークの品質検査とOK/NG判定

```
Work-A ─→ Inspection ─→ Work-A (qualityStatus更新)
```

**設定パラメータ**:
```json
{
  "processingTime": 2.0,
  "arrivalTime": 1.0,
  "departureTime": 1.0,
  "okProbability": 0.9     // OK判定の確率
}
```

**処理内容**:
- ワークの `qualityStatus` を更新（OK/NG）
- ワーク自体は変更しない（通過型）

#### Discharge Station（振り分け）

**役割**: 品質ステータスに応じた経路分岐

```
              ┌─→ OK経路
Work ─→ Discharge
              └─→ NG経路
```

**設定パラメータ**:
```json
{
  "arrivalTime": 1.0,
  "departureTime": 1.0
}
```

**処理内容**:
- 処理時間なし（即座に振り分け）
- 接続の `condition` フィールドに基づいてルーティング

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
| **ProcessingStarted** | 処理開始 | ワーク到着 + 搬入可 |
| **ProcessingCompleted** | 処理完了 | 処理時間経過後 |
| **WorkDeparted** | ワーク出発 | 搬出可 + 次ステーション搬入可 |
| **WorkDestroyed** | ワーク破棄 | Drainステーション到着 |

### イベントループ

```go
// Run executes the simulation until the time limit or event exhaustion
func (e *Engine) Run(simulationID, friendlyName string, timeLimit float64) (*domain.Simulation, error) {
    // Initialize: Schedule FIRST WorkCreated event for each source station
    for _, station := range e.scenario.Stations {
        if station.Type == domain.StationTypeSource {
            e.eventQueue.Push(NewEvent(EventWorkCreated, 0.0, station.ID, nil))
        }
    }

    // Event loop
    for !e.eventQueue.IsEmpty() {
        event := e.eventQueue.Pop()
        e.currentTime = event.Time

        // Check time limit
        if e.currentTime > timeLimit {
            simulation.Complete(timeLimit, domain.EndReasonTimeLimit)
            break
        }

        // Process event
        if err := e.processEvent(event, simulation); err != nil {
            return nil, err
        }
    }

    return simulation, nil
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
}

type PriorityQueue struct {
    events []*Event
}

func (pq *PriorityQueue) Push(event *Event)
func (pq *PriorityQueue) Pop() *Event
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
Scenarios (シナリオ定義)
    ├─ scenario_id (PK)
    ├─ friendly_name
    ├─ scenario_data (JSONB)
    └─ created_at

Simulation_Runs (シミュレーション実行)
    ├─ simulation_id (PK)
    ├─ scenario_id (FK)
    ├─ friendly_name
    ├─ status
    ├─ end_time
    ├─ end_reason
    └─ created_at

Work_Events (ワークイベントログ)
    ├─ id (PK)
    ├─ simulation_id (FK)
    ├─ work_id
    ├─ work_friendly_name
    ├─ station_id
    ├─ timestamp
    └─ event_type

Station_Status_Logs (ステーション状態ログ)
    ├─ id (PK)
    ├─ simulation_id (FK)
    ├─ station_id
    ├─ timestamp
    ├─ status_type
    └─ value

Work_Lineage (ワーク系譜)
    ├─ id (PK)
    ├─ simulation_id (FK)
    ├─ child_work_id
    ├─ parent_work_id
    ├─ operation_type (merge/split)
    ├─ station_id
    └─ timestamp
```

### シナリオデータ構造（JSONB）

```json
{
  "name": "シナリオ名",
  "stations": [
    {
      "id": "station-1",
      "type": "source|processing|drain",
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
      "condition": "default|quality_ok|quality_ng"
    }
  ]
}
```

---

## 今後の拡張性

### フェーズ1: ステーション種別の追加（次のステップ）

1. **Merge Station の実装**
   - 複数ワーク保持の仕組み追加
   - 待機状態の実装
   - トレーサビリティの実装

2. **Split Station の実装**
   - 複数ワーク送出の仕組み
   - ラウンドロビンルーティング
   - 子ワーク追跡

3. **Inspection/Discharge Station の実装**
   - 品質ステータスの導入
   - 条件付きルーティング

### フェーズ2: 高度な機能

1. **複数経路対応**
   - 複数の接続先への分岐
   - 条件付きルーティングの拡張

2. **リアルタイムシミュレーション**
   - WebSocketによるライブ更新
   - 進行中のシミュレーションの可視化

3. **パフォーマンス分析**
   - ボトルネック検出
   - 稼働率計算
   - サイクルタイム分析

4. **最適化機能**
   - パラメータ自動調整
   - 遺伝的アルゴリズムによる最適化

### フェーズ3: エンタープライズ機能

1. **スケーラビリティ**
   - 大規模シナリオ対応（1000+ステーション）
   - 分散シミュレーション

2. **高度な可視化**
   - 2Dガントチャート
   - 統計ダッシュボード
   - レポート生成

3. **統合機能**
   - REST API拡張
   - gRPC対応
   - 外部システム連携

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
