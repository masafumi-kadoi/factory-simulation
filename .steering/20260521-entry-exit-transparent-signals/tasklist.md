# タスクリスト

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

---

## フェーズ1: engine.go への実装

- [x] `getDownstreamIRForEntry(entry)` を追加
  - [x] Entry から GetConnectionsFrom で下流接続を取得
  - [x] 接続先が Merge/Switch-merge ポートの場合は IsPortInputReady を使用
  - [x] 通常ステーションの場合は IsInputReady を使用

- [x] `getUpstreamORForExit(exit)` を追加
  - [x] Exit から GetConnectionsTo で上流接続を取得
  - [x] 接続元が Split/Switch-divert ポートの場合は IsPortOutputReady を使用
  - [x] 通常ステーションの場合は IsOutputReady を使用

- [x] `applyEntryIRDerivation(entry)` を追加
  - [x] Entry.IR = downstream.IR AND NOT(Entry.IWP) を計算
  - [x] 変化がある場合のみ SetSignal + statusLogs に signal_change を追記

- [x] `applyExitORDerivation(exit)` を追加
  - [x] Exit.OR = upstream.OR OR Exit.OWP を計算
  - [x] 変化がある場合のみ SetSignal + statusLogs に signal_change を追記

- [x] `propagateToNeighborEntryExit(station)` を追加
  - [x] 上流接続を走査し Entry があれば applyEntryIRDerivation → checkHandshakes
  - [x] 下流接続を走査し Exit があれば applyExitORDerivation → checkHandshakes

- [x] `evaluateAndLogSignals` の末尾に呼び出しを追加
  - [x] station が Entry の場合: applyEntryIRDerivation → checkHandshakes
  - [x] station が Exit の場合: applyExitORDerivation → checkHandshakes
  - [x] 全ステーション共通: propagateToNeighborEntryExit

- [x] WorkArrived interlock チェックを Entry 用に修正（追加タスク）
  - [x] Entry は IWP のみチェック（IR チェックをスキップ）
  - [x] Transit 中に proc-inner が処理開始して IR=OFF になっても到着できるようにする

## フェーズ2: テスト・動作確認

- [x] 既存テストがすべて通ることを確認
  - [x] `cd simulation-core && go test ./...`

## フェーズ3: ドキュメント更新

- [x] `SIMULATION-ENGINE.md` の Entry/Exit 信号フロー節を更新
  - [x] Entry の信号フロー（透過動作）を記述
  - [x] Exit の信号フロー（透過動作）を記述
  - [x] propagateToNeighborEntryExit の動作を記述

---

## 実装後の振り返り

### 実装完了日
2026-05-21

### 計画と実績の差分

**計画と異なった点**:
- WorkArrived の interlock チェック修正が追加タスクとして必要になった

**新たに必要になったタスク**:
- Entry への WorkArrived 時に IR チェックをスキップする修正
  - 理由: Transit 中に proc-inner が処理開始して IR=OFF になると、すでにコミット済みのワークが interlock violation で弾かれるため

### 学んだこと

**技術的な学び**:
- 透過 IR による「送出ブロック」と「到着チェック」は別物。送出側（checkHandshakes）で IR=OFF をチェックし、到着側（WorkArrived）はコミット済みワークとして受け入れる設計が正しい
- Transit 時間がある限り、「送出時に IR=ON だったが到着時に IR=OFF」というウィンドウは不可避。この場合はワークが Entry でバッファリングされる（これは仕様）
