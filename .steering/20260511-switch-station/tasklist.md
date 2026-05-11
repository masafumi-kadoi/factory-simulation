# タスクリスト: Switch ステーション型実装

## 🚨 タスク完全完了の原則

**このファイルの全タスクが完了するまで作業を継続すること**

---

## フェーズ1: domain 層

- [x] `StationTypeSwitch = "switch"` を `domain/station.go` に追加
- [x] `GetDirection()` ヘルパーメソッドを Station に追加（`config["direction"]` を返す）
- [x] `GetSwitchSelectMode()` / `GetSwitchPortCount()` / `GetSwitchSequence()` / `GetSwitchPriorityOrder()` を追加
- [x] `CanStartProcessing()` に Switch を除外追加
- [x] ~~`InputPortCount()` を Switch merge 対応に更新~~（実装方針変更により不要: ポートバッファなし設計）
- [x] ~~`OutputPortCount()` を Switch divert 対応に更新~~（実装方針変更により不要: ポートバッファなし設計）
- [x] ~~`getPortsConfig()` を Switch 対応に更新~~（実装方針変更により不要: ポートバッファなし設計）
- [x] ~~`InitializePorts()` を Switch 対応に更新~~（実装方針変更により不要: ポートバッファなし設計）
- [x] ~~`AddWorkToSwitchInputPort(work *Work, portIndex int) error` を追加~~（実装方針変更により不要: ポートバッファなし設計）

## フェーズ2: interlock 層

- [x] `getSwitchDefaultConfig()` を `domain/interlock.go` に追加（Entry 相当のパススルー設定）
- [x] `GetDefaultInterlockConfig()` に `StationTypeSwitch` ケースを追加

## フェーズ3: エンジン — 基盤

- [x] `SwitchState` 構造体を定義（SeqIndex int）
- [x] `switchStates map[string]*SwitchState` / `switchDivertTarget map[string]string` を Engine 構造体に追加
- [x] `NewEngineWithInitialConditions` で初期化
- [x] `selectSwitchPort(station, numPorts, candidates) int` を実装
  - [x] `round-robin` モード（seqIndex を使用、fallback あり）
  - [x] `sequence` モード（config の sequence 配列を使用、fallback あり）
  - [x] `priority` モード（priorityOrder を使用、fallback なし）
  - [x] `first-available` モード（candidates[0] を返す）
- [x] `collectSwitchMergeCandidates(station)` — merge 方向の準備済み接続収集
- [x] `collectSwitchDivertCandidates(station)` — divert 方向の準備済み接続収集

## フェーズ4: エンジン — merge 方向ハンドラ

- [x] ~~`handleWorkArrived()` にポートバッファ分岐を追加~~（実装方針変更により不要: ポートバッファなし設計）
- [x] `scheduleSwitchMerge(station)` を実装（候補収集→selectSwitchPort→上流の WorkDeparted スケジュール）
- [x] `handleWorkDeparted()` に Switch merge は通常の WorkArrived 経路で対応（ポートバッファなし）

## フェーズ5: エンジン — divert 方向ハンドラ

- [x] ~~`handleProcessingCompleted()` に Switch divert 分岐~~（実装方針変更により不要: Entry-like パススルー）
- [x] `scheduleSwitchDivert(station)` を実装（候補収集→selectSwitchPort→switchDivertTarget→WorkDeparted スケジュール）
- [x] `handleWorkDeparted()` に Switch divert 分岐を追加 → `handleSwitchDivertWorkDeparted()`
- [x] `handleSwitchDivertWorkDeparted(event, station)` を実装
  - [x] pendingDepartures クリア、target 検証（なければ checkHandshakes で再選択）
  - [x] 信号クリア → evaluateAndLogSignals → target を予約 → WorkArrived スケジュール

## フェーズ6: checkHandshakes 拡張

- [x] Case 1c を追加: Switch divert — `scheduleSwitchDivert(station)`
- [x] Case 1 修正: 下流が Switch merge なら `scheduleSwitchMerge(toStation)`
- [x] Case 2c を追加: Switch merge — `scheduleSwitchMerge(station)`
- [x] Case 2 修正: 上流が Switch divert なら `scheduleSwitchDivert(fromStation)`

## フェーズ7: ビルドとテスト

- [x] `go build ./...` が通ること
- [x] `selectSwitchPort()` のユニットテストを `engine_switch_test.go` に追加
  - [x] round-robin: 優先ポートが candidates にある場合
  - [x] round-robin: 優先ポートが candidates にない場合（fallback）
  - [x] sequence: カスタム配列での動作
  - [x] priority: 上位優先ポートが candidates にある場合
  - [x] priority: 上位優先ポートが candidates にない場合（stall = -1 返却）
  - [x] first-available: candidates[0] が返ること
- [x] Switch merge 統合テスト（2上流 → 1下流、round-robin 交互）
- [x] Switch divert 統合テスト（1上流 → 2下流、round-robin 交互）
- [x] 既存テストが変化しないこと: `go test ./...`

## フェーズ8: デモシナリオ更新

- [x] `demo-2source-7moduler` の `scenario.json` を Switch 対応に更新
  - [x] switch-5 (Switch merge) を追加し mod-3/mod-4 → switch-5 → mod-5 に再接続
  - [x] mod-5 を single-entry に変更（entry-1 とその接続を削除）
  - [x] シナリオを API に再登録（PUT /api/scenarios/0d7252ae-6406-46ee-8f02-555e8178d85b）
- [x] Live モードテストを実行して交互搬入を確認（130942/130942 イベント完了）

---

## 実装後の振り返り

### 実装完了日
2026-05-11

### 計画と実績の差分

**計画と異なった点**:
- 最大の変更: ポートバッファなし設計への簡略化。当初設計では InPorts[1+]/OutPorts[1+] を使って Merge/Split と同様のポートバッファを設けていたが、Switch は body に直接複数接続できる（単一ポート機構を流用）ことが実装前分析で判明。Phase 1 の 5 タスクがスキップに。
- `handleWorkArrived` / `handleProcessingCompleted` のハンドラ追加が不要になった（Entry-like パススルーが既存の通常 WorkArrived パスで動作する）。
- `handleWorkDeparted` に Switch merge 専用ハンドラは不要（通常の WorkDeparted で動作）。Switch divert のみ `handleSwitchDivertWorkDeparted` を追加。
- checkHandshakes の修正: Case 1 に `SwitchDivert` 除外と `SwitchMerge downstream` の委譲を追加。Case 2 に `SwitchMerge` の `scheduleSwitchMerge()` 委譲と `SwitchDivert upstream` の委譲を追加。

**新たに必要になったタスク**:
- `scheduleSwitchMerge()` / `scheduleSwitchDivert()` のヘルパーメソッド追加（設計書にはなかったが、checkHandshakes のコードを清潔に保つために分離）
- `selectBySequence()` ヘルパーの分離（round-robin と sequence の共通ロジック）
- `switchDivertTarget map[string]string` の追加（divert 先を WorkDeparted スケジュール時に保存し、handleWorkDeparted で使用）

### 学んだこと

**技術的な学び**:
- 既存の単一ポート body 機構（InPorts[0]/OutPorts[0]）は、接続が複数あっても 1:N または N:1 の流量制御（pending/reserved）で処理できる。ポートバッファは複数ワーク「同時保持」が必要な場合のみ必要。
- checkHandshakes の Case 1 / Case 2 は「どの方向から制御するか」の設計上の分岐点。Switch のような「選択する側」は既存の全候補スケジュールを委譲先で絞り込む形にするとシンプルになる。
- `switchDivertTarget` の保存と再試行パターン（target 消滅時に `checkHandshakes` で再選択）は競合状態に強い設計。

### 次回への改善提案
- Switch を Moduler 内の subScenario でも使えるか検証（フラット化後の接続インデックスが正しく引けるか）
- `selectSwitchPort` の `priority` モードで fallback なし（stall）の動作を統合テストで確認するテストを追加
- Switch divert + Merge のチェーン（1 → N → 1 経路）のテストシナリオを追加
