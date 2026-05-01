# シミュレーションエンジン動作仕様書

## 概要

Factory Simulationエンジンは**離散イベントシミュレーション**方式で動作します。
全てのワーク移動・加工は**10信号インターロック**によって制御され、上流の`outputReady=ON`と下流の`inputReady=ON`が同時に成立した時のみワークが搬送されます（**ハンドシェイク方式**）。

---

## 10信号モデル

全ステーションはステーション本体に以下の10信号を持ちます。

| 信号名 | 略称 | 種別 | 説明 |
|--------|------|------|------|
| `inputWorkPresent` | IWP | 状態 | 入力ワークが存在する |
| `processingWorkPresent` | PWP | 状態 | 加工中のワークが存在する |
| `outputWorkPresent` | OWP | 状態 | 出力ワークが存在する |
| `running` | RUN | 状態 | 加工実行中 |
| `complete` | CPL | 状態 | 加工完了済み |
| `processReady` | PR | 制御 | 加工開始可能 |
| `inputReady` | IR | 制御 | 搬入可能 |
| `outputReady` | OR | 制御 | 搬出可能 |
| `workFull` | WF | タイマー | ワーク滞留（一定時間ワーク有） |
| `workEmpty` | WE | タイマー | ワーク枯渇（一定時間ワーク無） |

**状態信号** (IWP, PWP, OWP, RUN, CPL): エンジンがワーク移動・加工に応じて自動セット
**制御信号** (IR, OR, PR): インターロックルールにより状態信号から導出
**タイマー信号** (WF, WE): 一定時間条件が継続すると発火

---

## ポートモデル

```
┌─────────────────────────────────────────────┐
│  Station                                     │
│                                              │
│  Work (単一ワーク、ステーション本体)            │
│  Signals (10信号 + 導出信号)                  │
│  InterlockRules (ステーションレベル)            │
│                                              │
│  InPorts[0] = ステーションレベル入力            │
│  InPorts[1+] = 追加入力ポート (Mergeのみ)      │
│  ├── Works[] (複数ワーク, Capacity制限)        │
│  ├── Signals (ポートレベル信号)               │
│  └── InterlockRules (ポートレベル)            │
│                                              │
│  OutPorts[0] = ステーションレベル出力           │
│  OutPorts[1+] = 追加出力ポート (Splitのみ)     │
│  ├── Works[] (複数ワーク, Capacity制限)        │
│  ├── Signals (ポートレベル信号)               │
│  └── InterlockRules (ポートレベル)            │
└─────────────────────────────────────────────┘
```

### ポートインデックスの対応

- `InPorts[0]` / `OutPorts[0]`: ステーションレベル（全ステーション共通）
- `InPorts[1]` = 入力ポート0（エディタ上の Port 1）— Merge用
- `OutPorts[1]` = 出力ポート0（エディタ上の Port 1）— Split用

> **注意**: エンジン内部では `GetInputPort(0)` → `InPorts[1]` のように +1 オフセットされます。

### 導出信号（Merge/Split）

Merge/Splitでは、ポートレベルの信号からステーションレベルの信号が**自動導出**されます。

| 導出信号 | ステーション種別 | 導出ロジック |
|----------|-----------------|-------------|
| `allPortsFull` | Merge | 全入力ポートが満杯（`len(Works) >= Capacity`） |
| `portNFull` | Merge | ポートN が満杯（動的: `port1Full`, `port2Full`, ...） |
| `inputReady` | Merge | いずれかの入力ポートの IR=ON（ANY） |
| `inputWorkPresent` | Merge | いずれかの入力ポートの IWP=ON（ANY） |
| `allPortsEmpty` | Split | 全出力ポートが空（`len(Works) == 0`） |
| `portNEmpty` | Split | ポートN が空（動的: `port1Empty`, `port2Empty`, ...） |
| `portNHasWork` | Split | ポートN にワーク有（動的: `port1HasWork`, ...） |
| `outputReady` | Split | いずれかの出力ポートの OR=ON（ANY） |
| `outputWorkPresent` | Split | いずれかの出力ポートの OWP=ON（ANY） |

導出は `evaluateAndLogSignals()` 内で、ルール評価の**前**に実行されます。

---

## ステーション別詳細

### 1. Source（ソース）

ワークを生成するステーション。外部からの搬入はありません。

```
                    ┌──────────┐
  ワーク生成 ─────→ │  Source   │ ────→ 下流へ
                    │  Port[0] │
                    └──────────┘
```

**ポート構成:**

| ポート | 用途 | ワーク |
|--------|------|--------|
| Port[0] | 本体 | 生成したワーク1つ |

**信号フロー:**

```
WorkCreated
  ├─ OWP = ON
  ├─ workType:<type> = ON (workTypeが設定されている場合)
  └─ evaluateRules
       └─ OR = ON (ルール: OWP=ON → OR=ON)
            └─ checkHandshakes
                 └─ 下流.IR=ON なら WorkDeparted スケジュール

WorkDeparted
  ├─ IWP, PWP, OWP = OFF
  ├─ CPL = OFF
  ├─ workType:* クリア
  └─ evaluateRules
       └─ OR = OFF
```

**デフォルトルール:**

| ID | 条件 | → | 結果 |
|----|------|---|------|
| R1 | OWP = ON | → | OR = ON |
| R2 | OWP = OFF | → | OR = OFF |

**ワーク生成制御:**
- `continuous = false`: `workCount` 個まで生成（1つずつ、搬出完了後に次を生成）
- `continuous = true`: 無限に生成

---

### 2. Processing（加工）

ワークを受け取り、加工し、搬出するステーション。

```
           ┌──────────────┐
 上流 ────→│  Processing   │────→ 下流へ
           │   Port[0]    │
           └──────────────┘
```

**ポート構成:**

| ポート | 用途 | ワーク |
|--------|------|--------|
| Port[0] | 本体 | 加工中ワーク1つ |

**信号フロー:**

```
WorkArrived
  ├─ IWP, PWP, OWP = ON
  ├─ workType:<type> = ON
  └─ evaluateRules
       ├─ IR = OFF (R2: IWP=ON → IR=OFF)
       └─ PR = ON  (R3: IWP=ON & RUN=OFF & CPL=OFF → PR=ON)
            └─ triggerProcessReady → ProcessingStarted スケジュール

ProcessingStarted
  ├─ RUN = ON
  └─ evaluateRules
       └─ PR = OFF (R4: RUN=ON → PR=OFF)
  └─ ProcessingCompleted をスケジュール (currentTime + processingTime)

ProcessingCompleted
  ├─ RUN = OFF
  ├─ CPL = ON
  └─ evaluateRules
       └─ OR = ON (R5: CPL=ON & OWP=ON → OR=ON)
            └─ checkHandshakes
                 └─ 下流.IR=ON なら WorkDeparted スケジュール

WorkDeparted
  ├─ IWP, PWP, OWP = OFF
  ├─ CPL, PR = OFF
  ├─ workType:* クリア
  └─ evaluateRules
       ├─ OR = OFF (R6: OWP=OFF → OR=OFF)
       └─ IR = ON  (R1: IWP=OFF → IR=ON)
            └─ checkHandshakes (上流.OR=ON なら WorkDeparted スケジュール)
```

**デフォルトルール:**

| ID | 条件 | → | 結果 |
|----|------|---|------|
| R1 | IWP = OFF | → | IR = ON |
| R2 | IWP = ON | → | IR = OFF |
| R3 | IWP=ON & RUN=OFF & CPL=OFF | → | PR = ON |
| R4 | RUN = ON | → | PR = OFF |
| R5 | CPL=ON & OWP=ON | → | OR = ON |
| R6 | OWP = OFF | → | OR = OFF |

---

### 3. Drain（排出）

ワークを受け取り、消費（破棄）するステーション。下流への搬出はありません。

```
           ┌──────────┐
 上流 ────→│  Drain    │  (ワーク消費)
           │  Port[0] │
           └──────────┘
```

**ポート構成:**

| ポート | 用途 | ワーク |
|--------|------|--------|
| Port[0] | 本体 | 受入ワーク1つ（即破棄） |

**信号フロー:**

```
WorkArrived
  ├─ IWP = ON
  └─ evaluateRules
       └─ IR = OFF (R2: IWP=ON → IR=OFF)
  └─ WorkDestroyed を即スケジュール

WorkDestroyed
  ├─ IWP = OFF
  ├─ workType:* クリア
  └─ evaluateRules
       └─ IR = ON (R1: IWP=OFF → IR=ON)
            └─ checkHandshakes (上流.OR=ON なら搬送開始)
```

**デフォルトルール:**

| ID | 条件 | → | 結果 |
|----|------|---|------|
| R1 | IWP = OFF | → | IR = ON |
| R2 | IWP = ON | → | IR = OFF |

---

### 4. Merge（結合）

複数入力ポートからワークを受け取り、1つの結合ワークを生成するステーション。

```
 上流A ──→ InPorts[1] (入力ポート0) ─┐
                                      │  ┌──────────┐
 上流B ──→ InPorts[2] (入力ポート1) ──┼─→│  Merge   │──→ 下流へ
                                      │  │  Work    │
 上流C ──→ InPorts[3] (入力ポート2) ─┘  └──────────┘
```

**ポート構成:**

| ポート | 用途 | ワーク |
|--------|------|--------|
| Work | 本体（結合ワーク出力） | 結合後ワーク1つ |
| InPorts[1] | 入力ポート0 | 入力ワーク（Capacity分） |
| InPorts[2] | 入力ポート1 | 入力ワーク（Capacity分） |
| InPorts[N+1] | 入力ポートN | 入力ワーク（Capacity分） |

**2層インターロック:**

| レイヤー | 対象 | 制御する信号 | 判定基準 |
|----------|------|------------|----------|
| **ポートレベル** | InPorts[1+] 各個別 | `inputReady` | そのポートにワークがあるか |
| **ステーションレベル** | Station.Signals | `outputReady`, `processReady` | 導出信号 `allPortsFull` による判定 |

**信号フロー:**

```
WorkArrived (InPorts[N+1]に到着)
  ├─ ポートレベル: port.IWP = ON
  │   └─ evaluatePortRules → port.IR = OFF
  ├─ deriveStationSignals:
  │   ├─ IWP = ANY(port.IWP)  ← 導出
  │   ├─ IR = ANY(port.IR)    ← 導出
  │   ├─ allPortsFull = ALL(port full)  ← 導出
  │   └─ portNFull = port[N] full  ← 導出
  └─ evaluateRules
       └─ PR = ON (R1: allPortsFull=ON & RUN=OFF & CPL=OFF → PR=ON)
            └─ triggerProcessReady → ProcessingStarted スケジュール

ProcessingStarted (結合処理開始)
  ├─ RUN = ON, PWP = ON
  └─ evaluateRules → PR = OFF (R2: RUN=ON → PR=OFF)

MergeCompleted (結合処理完了)
  ├─ 全ポートのワーク消費 → 結合ワークを Work に生成
  ├─ ポートレベル: 全port.IWP = OFF → port.IR = ON
  ├─ deriveStationSignals → IWP=OFF, allPortsFull=OFF
  ├─ ステーションレベル: RUN=OFF, CPL=ON, OWP=ON
  └─ evaluateRules
       └─ OR = ON (R3: CPL=ON & OWP=ON → OR=ON)
            └─ checkHandshakes → 下流.IR=ON なら WorkDeparted

WorkDeparted (結合ワーク搬出)
  ├─ PWP, OWP, CPL, PR = OFF
  ├─ deriveStationSignals → IWP/IR をポートから再導出
  └─ evaluateRules
       └─ OR = OFF (R4: OWP=OFF → OR=OFF)
            └─ checkHandshakes (各ポートの上流を確認)
```

**デフォルトルール（ステーションレベル）:**

| ID | 条件 | → | 結果 |
|----|------|---|------|
| R1 | allPortsFull=ON & RUN=OFF & CPL=OFF | → | PR = ON |
| R2 | RUN = ON | → | PR = OFF |
| R3 | CPL=ON & OWP=ON | → | OR = ON |
| R4 | OWP = OFF | → | OR = OFF |

**デフォルトルール（ポートレベル）:**

| ID | 条件 | → | 結果 |
|----|------|---|------|
| R1 | IWP = OFF | → | IR = ON |
| R2 | IWP = ON | → | IR = OFF |

**ハンドシェイク判定:**

```
搬入時: 上流.OR = ON  AND  ポート[N].IR = ON  → 搬送開始
搬出時: ステーション.OR = ON  AND  下流.IR = ON  → 搬送開始
```

> ステーションレベルの `inputReady` はポートから導出されます（ANY）。
> **搬入判定にはポートレベルの `inputReady` が使われます。**

---

### 5. Split（分割）

結合ワークを受け取り、元の構成要素に分割して各出力ポートから搬出するステーション。

```
                    ┌──────────┐
 上流 ────→  Work   │  Split   │ OutPorts[1] (出力ポート0) ──→ 下流A
                    │          │ OutPorts[2] (出力ポート1) ──→ 下流B
                    │          │ OutPorts[3] (出力ポート2) ──→ 下流C
                    └──────────┘
```

**ポート構成:**

| ポート | 用途 | ワーク |
|--------|------|--------|
| Work | 本体（結合ワーク入力） | 受入ワーク1つ |
| OutPorts[1] | 出力ポート0 | 分割後ワーク |
| OutPorts[2] | 出力ポート1 | 分割後ワーク |
| OutPorts[N+1] | 出力ポートN | 分割後ワーク |

**2層インターロック:**

| レイヤー | 対象 | 制御する信号 | 判定基準 |
|----------|------|------------|----------|
| **ステーションレベル** | Station.Signals | `inputReady`, `processReady` | 導出信号 `allPortsEmpty` による判定 |
| **ポートレベル** | OutPorts[1+] 各個別 | `outputReady` | そのポートにワークがあるか |

**信号フロー:**

```
WorkArrived (Workに到着)
  ├─ IWP, PWP, OWP = ON
  └─ evaluateRules
       ├─ IR = OFF (R2: IWP=ON → IR=OFF)
       └─ PR = ON (R3: IWP=ON & RUN=OFF & CPL=OFF → PR=ON)
            └─ triggerProcessReady → ProcessingStarted スケジュール

ProcessingStarted
  ├─ RUN = ON
  └─ evaluateRules → PR = OFF (R4: RUN=ON → PR=OFF)

ProcessingCompleted (分割処理)
  ├─ ExecuteSplit: Work消費 → 各OutPorts[1+]にワーク配分
  ├─ ポートレベル: 各port.OWP = ON → port.OR = ON
  ├─ deriveStationSignals:
  │   ├─ OWP = ANY(port.OWP)  ← 導出
  │   ├─ OR = ANY(port.OR)    ← 導出
  │   ├─ allPortsEmpty = ALL(port empty) = OFF  ← 導出
  │   └─ portNEmpty / portNHasWork  ← 導出
  ├─ ステーションレベル: RUN=OFF, CPL=ON, IWP=OFF, PWP=OFF
  └─ evaluateRules
       └─ checkHandshakes (各ポート個別)
            └─ port[N].OR=ON & 下流.IR=ON → PortWorkDeparted スケジュール

PortWorkDeparted (各ポートから個別に搬出)
  ├─ ポートレベル: port.OWP = OFF → port.OR = OFF
  ├─ deriveStationSignals → allPortsEmpty / OWP / OR 再導出
  └─ 全ポート空? → ステーションリセット
       ├─ CPL = OFF
       └─ evaluateRules → IR = ON (R1: allPortsEmpty=ON & IWP=OFF & RUN=OFF & CPL=OFF)
```

**デフォルトルール（ステーションレベル）:**

| ID | 条件 | → | 結果 |
|----|------|---|------|
| R1 | allPortsEmpty=ON & IWP=OFF & RUN=OFF & CPL=OFF | → | IR = ON |
| R2 | IWP = ON | → | IR = OFF |
| R3 | IWP=ON & RUN=OFF & CPL=OFF | → | PR = ON |
| R4 | RUN = ON | → | PR = OFF |

**デフォルトルール（ポートレベル）:**

| ID | 条件 | → | 結果 |
|----|------|---|------|
| R1 | OWP = ON | → | OR = ON |
| R2 | OWP = OFF | → | OR = OFF |

**ハンドシェイク判定:**

```
搬入時: 上流.OR = ON  AND  ステーション.IR = ON  → 搬送開始
搬出時: ポート[N].OR = ON  AND  下流.IR = ON  → ポート個別に搬送開始
```

**ワーク種別ルーティング:**
接続条件に `workType:partA` を設定すると、そのポートから出た特定種別のワークのみがその接続先に流れます。

---

### 6. Entry（エントリー）

Modulerステーション内部の入口。**透過ステーション**（加工時間0、即通過）。

```
           ┌──────────┐
 外部 ────→│  Entry   │────→ 内部ステーションへ
           │  Port[0] │
           └──────────┘
```

**ポート構成:**

| ポート | 用途 | ワーク |
|--------|------|--------|
| Port[0] | 本体 | 通過ワーク1つ |

**信号フロー（即通過）:**

```
WorkArrived
  ├─ IWP, OWP = ON
  ├─ State = Completed (Receiving/Processingをスキップ)
  └─ evaluateRules
       └─ OR = ON → checkHandshakes → WorkDeparted

WorkDeparted
  ├─ IWP, PWP, OWP, CPL, PR = OFF
  └─ evaluateRules → IR = ON
```

> ProcessingStarted / ProcessingCompleted イベントは**発生しません**。

**デフォルトルール:**

| ID | 条件 | → | 結果 |
|----|------|---|------|
| R1 | OWP = ON | → | OR = ON |
| R2 | OWP = OFF | → | OR = OFF |
| R3 | IWP = OFF | → | IR = ON |
| R4 | IWP = ON | → | IR = OFF |

---

### 7. Exit（イグジット）

Modulerステーション内部の出口。Entryと同じ透過動作。

```
                    ┌──────────┐
 内部ステーション ──→│   Exit   │────→ 外部へ
                    │  Port[0] │
                    └──────────┘
```

ポート構成・信号フロー・デフォルトルールは **Entry と同一**です。

---

### 8. Moduler（モジュラー）

内部にサブシナリオを持つ複合ステーション。シミュレーション実行時に**フラットに展開**されます。

```
 ┌───────────── Moduler ─────────────┐
 │                                    │
 │  Entry ──→ Processing ──→ Exit    │
 │                                    │
 │  Work: なし (信号導出用)            │
 │  InPorts[1+]/OutPorts[1+]: Entry/Exit │
 └────────────────────────────────────┘
```

**ポート構成:**

| ポート | 用途 | ワーク |
|--------|------|--------|
| Work | 本体（信号の集約用） | なし（直接ワークを保持しない） |
| InPorts[1+] | Entry外部接続ポート | エディタ上のポート接続用 |
| OutPorts[1+] | Exit外部接続ポート | エディタ上のポート接続用 |

**フラット展開（実行時）:**

```
展開前:
  Source → Moduler → Drain

展開後:
  Source → mod-1.entry-1 → mod-1.proc-1 → mod-1.exit-1 → Drain

  ※ 内部ステーションIDは "親ID.子ID" 形式にプレフィックス付与
```

**StationModulerMap（内部ステーション→親Modulerマッピング）:**

フラット展開時に `buildStationModulerMap()` が構築する `map[string]string`。各内部ステーションIDをキーとし、親ModulerステーションIDを値とする。

| 用途 | 旧方式 | 新方式 |
|------|--------|--------|
| `isInternalStation()` | `strings.Contains(id, ".")` — O(1)だが命名規約に依存 | `stationModulerMap[id]` — O(1)、構造的に正確 |
| `findParentModuler()` | 全Modulerの全InternalStationIDsを走査 — O(M×I) | `stationModulerMap[id]` — O(1) |

> `stationModulerMap` が未構築（nil）の場合はフォールバック（旧方式）が動作する。

**信号導出（内部→親）:**

Modulerの Signals は内部ステーションの状態から**自動導出**されます。

| 親Moduler信号 | 導出元 |
|---------------|--------|
| `inputWorkPresent` | inputMonitorStation のいずれかにワーク有 |
| `processingWorkPresent` | 非モニターの内部ステーションのいずれかにワーク有 |
| `outputWorkPresent` | outputMonitorStation のいずれかにワーク有 |
| `running` | 内部ステーションのいずれかが RUN=ON |

> 内部ステーションのイベント処理後、毎回 `deriveModulerSignals()` → `evaluateAndLogSignals()` が呼ばれます。

**デフォルトルール:**

| ID | 条件 | → | 結果 |
|----|------|---|------|
| R1 | IWP = OFF | → | IR = ON |
| R2 | IWP = ON | → | IR = OFF |
| R3 | CPL=ON & OWP=ON | → | OR = ON |
| R4 | OWP = OFF | → | OR = OFF |

---

## エンジン実行フロー

### 初期化

```
1. FlattenScenario: ModulerStation を再帰的にフラット展開
   └─ StationModulerMap を構築（内部ステーションID → 親Moduler IDのマッピング）
2. BuildStationIndex: O(1)ルックアップ用インデックスを構築
   ├─ stationIndex: ステーションID → Stationsスライス内インデックス
   ├─ connectionsFrom: ステーションID → 出力接続インデックス群
   └─ connectionsTo: ステーションID → 入力接続インデックス群
3. stationModulerMap をEngineに設定
4. 全ステーション:
   ├─ InitializeInterlockRulesFromConfig (カスタムルール読込)
   ├─ InterlockRules未設定 → GetDefaultInterlockConfig (デフォルト適用)
   ├─ InitializeSignals (ステーションレベルの全信号を初期値にセット)
   └─ InitializePorts (InPorts[1+]/OutPorts[1+]を生成、ポートレベルルール適用)
5. タイマーデフォルト値初期化 (initializeTimerDefaults)
6. 全ステーション: deriveStationSignals + evaluateRules (初期制御信号の計算)
7. 初期ワーク配置 (placeInitialWorks)
8. 各Sourceに WorkCreated イベントをスケジュール (time=0)
```

### イベントループ

```
while (イベントキューが空でない AND 現在時刻 ≤ timeLimit):
    event = キューから最小時刻のイベントを取得
    currentTime = event.Time
    processEvent(event)
    if isInternalStation(event.StationID):  // stationModulerMapでO(1)判定
        triggerModulerDerivation (親Modulerの信号再導出)
```

### ハンドシェイク（搬送開始条件）

ワーク搬送は、`evaluateAndLogSignals()` 内で `checkHandshakes()` が呼ばれて判定されます。
接続の走査には `GetConnectionsFrom()` / `GetConnectionsTo()` を使用し、`BuildStationIndex()` で構築されたインデックスによりO(degree)で隣接接続を取得します。

```
checkHandshakes(station):

  Case 1: station が上流 (非Split)
    station.OR=ON & station.Work≠nil → 下流の IR チェック
      ├─ 下流がMerge → InPorts[N].IR チェック
      └─ 下流が通常  → station.IR チェック
    → 両方ON なら WorkDeparted スケジュール

  Case 1b: station が Split
    各OutPorts[N].OR=ON → 下流の IR チェック
    → 両方ON なら PortWorkDeparted スケジュール

  Case 2: station が下流 (非Merge)
    station.IR=ON → 上流の OR チェック
      ├─ 上流がSplit → OutPorts[N].OR チェック
      └─ 上流が通常  → station.OR チェック
    → 両方ON なら WorkDeparted スケジュール

  Case 2b: station が Merge
    各InPorts[N].IR=ON → 上流の OR チェック
    → 両方ON なら WorkDeparted スケジュール
```

---

## 全ステーション ポート・信号 比較表

| ステーション | Work 用途 | InPorts[1+] | OutPorts[1+] | IR 判定 | OR 判定 | PR |
|-------------|----------|-------------|--------------|---------|---------|------|
| **Source** | ワーク生成・搬出 | なし | なし | × (搬入なし) | ステーション | × |
| **Processing** | 搬入・加工・搬出 | なし | なし | ステーション | ステーション | ステーション |
| **Drain** | ワーク受入・破棄 | なし | なし | ステーション | × (搬出なし) | × |
| **Merge** | 結合ワーク搬出 | 入力ポート | なし | **ポート(導出)** | ステーション | ステーション(allPortsFull) |
| **Split** | ワーク受入・分割 | なし | 出力ポート | ステーション(allPortsEmpty) | **ポート(導出)** | ステーション |
| **Entry** | 即通過 | なし | なし | ステーション | ステーション | × |
| **Exit** | 即通過 | なし | なし | ステーション | ステーション | × |
| **Moduler** | 信号集約（ワーク非保持） | Entry接続 | Exit接続 | ステーション(導出) | ステーション(導出) | × |

---

## ワーク種別ルーティング

接続の `condition` フィールドに `workType:<type>` を設定すると、ワーク種別に基づいたルーティングが行われます。

```
Split Port[1] ──[workType:partA]──→ Processing-A
Split Port[2] ──[workType:partB]──→ Processing-B
Split Port[3] ──[default]─────────→ Processing-Default
```

判定順序:
1. `workType:<type>` 条件に一致する接続を優先
2. 一致しない場合は `default` 条件の接続にフォールバック

---

## タイマー信号 (workFull / workEmpty)

| 信号 | 発火条件 | 用途 |
|------|----------|------|
| `workFull` | ワーク到着後、`stayTime` 秒経過してもワークが残っている | 滞留検出 |
| `workEmpty` | ワーク搬出後、`noWorkTimeout` 秒経過してもワークが来ない | 枯渇検出 |

```
WorkArrived → workEmptyタイマー取消、workFullタイマー開始
WorkDeparted → workFullタイマー取消、workEmptyタイマー開始
```

これらの信号はインターロックルールの条件として使用でき、たとえば「滞留時に搬出を優先する」などの制御が可能です。

---

## ログ構造とModulerID

全てのログ（`StationStatusLog`, `WorkEventLog`）には `ModulerID` フィールドが付与されます。

| ログ種別 | ModulerID の値 |
|----------|---------------|
| トップレベルステーションのログ | `""` (空文字) |
| Moduler内部ステーションのログ | 親ModulerステーションID (例: `"moduler-1"`) |

これにより、フラットなログ出力をModuler構造ベースでグルーピング・フィルタリングできます。

```
例: moduler-1 内部のログのみ抽出
  StationStatusLog { StationID: "moduler-1.proc-1", ModulerID: "moduler-1", ... }
  WorkEventLog     { StationID: "moduler-1.proc-1", ModulerID: "moduler-1", ... }
```

`ModulerID` は `stationModulerMap` から自動で設定されるため、ログ出力側での明示的な判定は不要です。

---

## インターロックルール評価

### 評価アルゴリズム

```
changed = true
iterations = 0
while changed AND iterations < 10:  // 最大10回の収束ループ
    changed = false
    for rule in rules:
        if allConditionsMet(rule.conditions, signals):
            if signals[rule.target] != rule.value:
                signals[rule.target] = rule.value
                changed = true
```

- ルールは**上から順に**評価され、条件が全て満たされればターゲット信号をセット
- 信号変更があった場合は再評価（最大10回で収束）
- ステーションレベルとポートレベルは**独立に評価**

### ステーション間参照

ルール条件に `stationId` を指定すると、他ステーションの信号を参照できます。

```json
{
  "signal": "outputReady",
  "value": true,
  "stationId": "proc-1"
}
```

> ポートレベルのルールではステーション間参照は無効（ローカル信号のみ）。
