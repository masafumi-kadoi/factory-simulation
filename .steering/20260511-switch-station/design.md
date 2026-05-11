# 設計書

## アーキテクチャ概要

新ステーション型 `StationTypeSwitch` を domain / interlock / engine の3層に追加する。既存の Merge/Split のポート構造（`InPorts[1+]` / `OutPorts[1+]`）を流用し、エンジンに Switch 専用の選択ロジックを追加する。

```
domain/station.go     … StationTypeSwitch 追加、ポート初期化対応
domain/interlock.go   … getSwitchDefaultConfig() 追加
simulation/engine.go  … SwitchState 管理、選択ロジック、ハンドラ追加
```

## コンポーネント設計

### 1. StationTypeSwitch（domain/station.go）

**ポート構造**

| direction | InPorts | OutPorts |
|---|---|---|
| merge | [0]=body, [1..N]=入力選択ポート | [0]=単一出力 |
| divert | [0]=body=単一入力 | [0]=body出力側, [1..N]=出力選択ポート |

**実装の要点**
- `InputPortCount()` に `StationTypeSwitch` + `direction="merge"` を追加
- `OutputPortCount()` に `StationTypeSwitch` + `direction="divert"` を追加
- `InitializePorts()` に Switch を追加（merge→inPorts、divert→outPorts）
- `getPortsConfig()` に Switch 用 key `"inPorts"` / `"outPorts"` を追加
- `AddWorkToSwitchInputPort(work, portIndex)` — merge 方向でポートに work を追加（AddWorkToPort の Switch 版）
- `getDirection()` ヘルパー（`s.Config["direction"].(string)` を返す）

**既存変更点**
- `InputPortCount()`: `StationTypeMerge` に加え `StationTypeSwitch`（merge）も対象
- `OutputPortCount()`: `StationTypeSplit` に加え `StationTypeSwitch`（divert）も対象
- `getPortsConfig()`: Switch 用の key 分岐追加

### 2. インターロック設定（domain/interlock.go）

**Switchステーション本体のデフォルト設定**

Entry 相当（搬入 → 搬出のパススルー）。merge/divert 共通。

```
R1: OWP=true  → outputReady=ON
R2: OWP=false → outputReady=OFF
R3: IWP=false → inputReady=ON
R4: IWP=true  → inputReady=OFF
```

**入力ポート（merge方向）の設定**

既存の `GetDefaultMergePortInterlockConfig()` をそのまま流用。

**出力ポート（divert方向）の設定**

既存の `GetDefaultSplitPortInterlockConfig()` をそのまま流用。

**実装の要点**
- `GetDefaultInterlockConfig()` に `StationTypeSwitch` ケースを追加
- `InitializePorts()` でのポート interlock config 取得を Switch 対応

### 3. SwitchState と選択ロジック（simulation/engine.go）

**SwitchState 構造体**

```go
type SwitchState struct {
    SeqIndex int // round-robin / sequence の現在位置
}
```

Engine に `switchStates map[string]*SwitchState` を追加。

**ポート選択ロジック: `selectSwitchPort(station, candidates []int) int`**

`candidates` = 準備済みポートのインデックスリスト（搬入可・搬出可フィルタ済み）

| selectMode | 動作 |
|---|---|
| `round-robin` | `sequence=[0..N-1]`。`seqIndex%len(seq)` のポートが candidates にあれば選択、なければ `candidates[0]`。選択後 seqIndex++ |
| `sequence` | config の `sequence` 配列を使用。それ以外は round-robin と同じ |
| `priority` | config の `priorityOrder` を先頭から見て candidates に含まれる最初のポートを選択 |
| `first-available` | `candidates[0]` を返す（state 不要） |

**準備済みポートの収集**

- merge方向: `InPorts[1..N]` を走査 → 対応する上流ステーションの `outputReady=true` かつ work あり かつ `pendingDepartures` なし → candidates に追加
- divert方向: `OutPorts[1..N]` を走査 → 対応する下流ステーションの `inputReady=true` かつ `reservedStations` なし → candidates に追加

接続の特定は `findConnectionToPort(stationID, portIndex)` / `findConnectionFromPort(stationID, portIndex)` を利用。

### 4. エンジンハンドラ追加（simulation/engine.go）

**WorkArrived ハンドラ**

```
handleWorkArrived() の分岐に StationTypeSwitch を追加:
  direction="merge" の入力ポート到着 → handleSwitchMergePortWorkArrived()
  direction="merge"/"divert" の本体到着 → 通常の handleWorkArrived 処理（既存）
```

**handleSwitchMergePortWorkArrived(work, station, portIndex)**
- `station.AddWorkToSwitchInputPort(work, portIndex)` でポートに追加
- portIndex に対応するポートの信号更新 (`updatePortDerivedSignals`)
- `evaluateAndLogSignals(station)` → `checkHandshakes(station)`

**handleSwitchDivertCompleted(station)**
- divert 方向の処理完了（もしくは処理なし到着）時に呼ばれる
- candidates を収集 → `selectSwitchPort()` → 選択ポートに work をセット
- 選択ポートの `outputReady` を ON にする

**checkHandshakes 追加ケース**

```
Case 1c: Switch merge — 入力ポートの outputReady が ON になった
  → 本体 (InPorts[0]) が inputReady かつ未予約なら
    candidates を収集 → selectSwitchPort → WorkDeparted をスケジュール

Case 2c: Switch merge — 本体の inputReady が ON になった（空きになった）
  → candidates を収集 → selectSwitchPort → WorkDeparted をスケジュール

Case 1d: Switch divert — 出力ポートに work が入った（outputReady ON）
  → 対応する下流の inputReady を確認 → WorkDeparted をスケジュール（Split の Case 1b 相当）
```

**WorkDeparted ハンドラ**

```
handleWorkDeparted() の分岐に Switch を追加:
  Switch merge の入力ポート出発 → handleSwitchMergePortWorkDeparted()
  Switch divert の出力ポート出発 → handleSwitchDivertPortWorkDeparted()
  Switch 本体の出発 → 既存の通常処理（reservedStations のセット等）
```

## データフロー

### Switch merge（round-robin, 2入力）

```
1. 上流-A が outputReady=ON
2. checkHandshakes (Case 1c): 本体が空 → candidates=[0] → seqIndex=0 → port-0 選択
   → pendingDepartures[上流-A] = true
3. WorkDeparted: 上流-A → port-0 に到着
4. handleSwitchMergePortWorkArrived: port-0 に work 追加
5. checkHandshakes (Case 2c): port-0 にwork → candidates=[0] のみ
   → port-0 の上流は already there → 本体への WorkDeparted スケジュール
6. WorkDeparted: port-0 → 本体に到着
7. 本体が work 保持 → outputReady=ON → 下流へ通常送出
8. seqIndex++ (次回は port-1 を優先)
```

### Switch divert（round-robin, 2出力）

```
1. 上流から work 到着 → 本体に格納
2. handleSwitchDivertCompleted: candidates 収集 → selectSwitchPort → port-0 選択
3. port-0 に work セット → outputReady=ON
4. checkHandshakes (Case 1d): 下流-A が inputReady → WorkDeparted スケジュール
5. WorkDeparted: port-0 → 下流-A に到着
6. seqIndex++ (次回は port-1 を優先)
```

## テスト戦略

### ユニットテスト
- `selectSwitchPort()` の全 selectMode（round-robin / sequence / priority / first-available）
- fallback 動作（優先ポートが candidates にない場合）
- candidates が空の場合（-1 を返す）

### 統合テスト
- Switch merge: 2上流 → 1下流、round-robin で交互受入
- Switch divert: 1上流 → 2下流、round-robin で交互送出
- 既存 Merge / Split シナリオのテストが変化しないこと

## ディレクトリ構造

```
simulation-core/internal/domain/
  station.go     … StationTypeSwitch 追加、ポート関連メソッド追加
  interlock.go   … getSwitchDefaultConfig() 追加

simulation-core/internal/simulation/
  engine.go      … SwitchState 追加、ハンドラ追加、checkHandshakes 拡張

simulation-core/internal/simulation/
  engine_switch_test.go  … Switch 統合テスト追加
```

## 実装の順序

1. `domain/station.go` — StationTypeSwitch 定義、ポート初期化
2. `domain/interlock.go` — getSwitchDefaultConfig()
3. `engine.go` — SwitchState、selectSwitchPort()
4. `engine.go` — merge 方向ハンドラ群
5. `engine.go` — divert 方向ハンドラ群
6. `engine.go` — checkHandshakes 拡張
7. テスト追加
8. demo-2source-7moduler シナリオを Switch 対応に更新

## 将来の拡張性

- GUI からの selectMode 設定は JSON config 経由で既に対応済み
- N入力 → M出力の完全ルーティングは本実装の延長で対応可能
- ワーク属性条件（workType, metadata）による動的振り分けは conditions 配列を追加することで対応可能
