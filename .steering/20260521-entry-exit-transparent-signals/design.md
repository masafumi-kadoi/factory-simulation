# 設計書

## アーキテクチャ概要

`evaluateAndLogSignals` の末尾に「Entry/Exit 信号導出」ステップを追加する。
既存の rules 評価後に導出を上書きするため、既存ルールの動作への影響を最小化する。

```
evaluateAndLogSignals(station)
  ├─ deriveStationSignals(station)        既存: Merge/Split 導出
  ├─ evaluateRules(station)               既存: ルール評価
  ├─ checkHandshakes(station)             既存: ハンドシェイク
  ├─ [NEW] applyEntryIRDerivation(station)   Entry の場合のみ IR を上書き
  ├─ [NEW] applyExitORDerivation(station)    Exit の場合のみ OR を上書き
  ├─ [NEW] checkHandshakes(station)       [NEW] 上書き後に再チェック（Entry/Exit のみ）
  └─ [NEW] propagateToNeighborEntryExit(station)  隣接 Entry/Exit に伝播
```

## コンポーネント設計

### 1. `getDownstreamIRForEntry(entry)`

**責務**:
- Entry が接続する先（`GetConnectionsFrom(entry.ID)` の最初の接続）の IR を返す
- 接続先が Merge ポートの場合は `IsPortInputReady(conn.ToPortIndex)` を参照

**実装の要点**:
- Entry の下流接続は通常1本。複数ある場合は最初の接続のみ使用
- ポート接続か否かは `conn.ToPortIndex >= 0` かつ接続先が Merge/Switch-merge かで判断

### 2. `getUpstreamORForExit(exit)`

**責務**:
- Exit に接続してくる元（`GetConnectionsTo(exit.ID)` の最初の接続）の OR を返す
- 接続元が Split ポートの場合は `IsPortOutputReady(conn.FromPortIndex)` を参照

**実装の要点**:
- Exit の上流接続は通常1本

### 3. `applyEntryIRDerivation(entry)`

**責務**:
- Entry.IR を `getDownstreamIRForEntry(entry) AND NOT(Entry.IWP)` で上書き
- 値が変化した場合のみ `statusLogs` に signal_change を記録

```
Entry.IR = downstream.IR AND (Entry.IWP=OFF)
```

理由: Entry 自身がワーク保持中（IWP=ON）の場合、キャパシティ上さらなる搬入不可。

### 4. `applyExitORDerivation(exit)`

**責務**:
- Exit.OR を `getUpstreamORForExit(exit) OR Exit.OWP` で上書き
- 値が変化した場合のみ `statusLogs` に signal_change を記録

```
Exit.OR = upstream.OR OR (Exit.OWP=ON)
```

理由: Exit 自身にワークがある場合（OWP=ON）は搬出可を維持する必要がある。

### 5. `propagateToNeighborEntryExit(station)`

**責務**:
- `GetConnectionsTo(station.ID)` で上流を走査し、Entry ステーションがあれば `applyEntryIRDerivation` → `checkHandshakes` を呼ぶ
- `GetConnectionsFrom(station.ID)` で下流を走査し、Exit ステーションがあれば `applyExitORDerivation` → `checkHandshakes` を呼ぶ

**実装の要点**:
- `checkHandshakes` は `pendingDepartures` ガードがあるため二重スケジュール不可
- Entry/Exit 自身を評価するときに無限ループが起きないことを確認済み
  - Entry の上流は外部ステーション（Entry 型でない）→ スキップされる
  - Exit の下流は外部ステーション（Exit 型でない）→ スキップされる

## データフロー

### Entry.IR バックプレッシャー（メイン動作）

```
B.proc 加工開始
  → B.proc.IR = OFF
  → propagateToNeighborEntryExit(B.proc)
    → B.entry が上流接続に Entry → applyEntryIRDerivation(B.entry)
      → Entry.IR = B.proc.IR AND NOT(IWP) = OFF
      → checkHandshakes(B.entry) → 外部から来ない

B.proc 加工完了・ワーク搬出
  → B.proc.IR = ON
  → propagateToNeighborEntryExit(B.proc)
    → applyEntryIRDerivation(B.entry)
      → Entry.IR = B.proc.IR AND NOT(IWP) = ON
      → checkHandshakes(B.entry) → 外部上流の OR=ON なら WorkDeparted
```

### Exit.OR 透過

```
B.proc 加工完了
  → B.proc.OR = ON
  → propagateToNeighborEntryExit(B.proc)
    → B.exit が下流接続に Exit → applyExitORDerivation(B.exit)
      → Exit.OR = upstream.OR OR OWP = ON OR false = ON
      → checkHandshakes(B.exit): GetWork()=nil のため Case1 はスキップ
        （spurious departure は handleWorkDeparted で GetWork()=nil チェックにより安全に abort）
  → checkHandshakes(B.proc): B.exit.IR=ON → WorkDeparted from B.proc to B.exit
  → WorkArrived at B.exit: OWP=ON → OR=ON → checkHandshakes → 外部下流へ
```

## エラーハンドリング戦略

- 接続先ステーションが nil の場合はスキップ（IR/OR を変更しない）
- IR/OR の変更がない場合はログを記録せず checkHandshakes も呼ばない（不要な処理を省く）

## テスト戦略

### 統合テスト（既存テストの動作確認）

- `integration_test.go`, `complex_scenarios_test.go` でマシンをまたぐシナリオが通ること
- `switch_moduler_test.go`, `phase1_test.go` など Entry/Exit を含むシナリオが通ること

### 新規テスト（必要に応じて）

- Source → Machine（Entry→proc→Exit）→ Drain のシンプルなシナリオ
- Machine 内 proc が忙しいとき外部 Source からワークが来ないことを確認

## ディレクトリ構造

変更ファイル:
```
simulation-core/internal/simulation/engine.go   主要実装
SIMULATION-ENGINE.md                             仕様書更新（Entry/Exit 信号フロー節）
```

## 実装の順序

1. `engine.go` に補助関数 4 本を追加
2. `evaluateAndLogSignals` の末尾に呼び出しを追加
3. 既存テストをすべて通す
4. `SIMULATION-ENGINE.md` を更新
